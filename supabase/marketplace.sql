-- ═══════════════════════════════════════════════════════════════════════════
-- MARKETPLACE — one catalogue, one cart, one order, one record of ownership
--
-- Run after registrations_v3.sql. Idempotent, safe to run twice.
--
-- The problem this solves
-- ----------------------
-- Before this, "buying" something was a button that showed an alert, and
-- course access was inferred from a `registered` column that does not exist
-- on the courses table. Nothing recorded what a student actually owns.
--
-- Five tables:
--   marketplace_products  everything sellable, whatever it is
--   cart_items            what one student intends to buy
--   orders                one checkout
--   order_items           what was in it, priced at the moment of sale
--   entitlements          what a student owns, and why
--
-- Why courses and assessments are products too
-- --------------------------------------------
-- A course already lives in the courses table with a cost on it. Rather than
-- a second parallel way to sell things, listing a course in the marketplace
-- creates a product row that points back at it through links_to_type and
-- links_to_id. One price, one cart, one checkout, one stock model. Paying for
-- that product grants an entitlement to the course itself.
--
-- Why prices are never read from the browser
-- ------------------------------------------
-- checkout_cart recomputes every line from the products table. The client can
-- ask to buy a product; it cannot say what that product costs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Catalogue ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text UNIQUE,
  title         text        NOT NULL,
  subtitle      text,
  description   text,

  -- book     physical, needs a delivery address
  -- download a file the buyer gets a link to
  -- course   access to a course already on the platform
  -- assessment access to a paid assessment or practice pack
  -- bundle   several of the above, sold together
  kind          text        NOT NULL DEFAULT 'book'
                CHECK (kind IN ('book', 'download', 'course', 'assessment', 'bundle')),

  -- Set for kind = course | assessment. The product is a shopfront for a row
  -- that already exists elsewhere, so there is never a second copy of it.
  links_to_type text CHECK (links_to_type IN ('course', 'assessment')),
  links_to_id   uuid,

  price         numeric(10,2) NOT NULL DEFAULT 0,
  compare_at    numeric(10,2),                  -- shown struck through when higher
  currency      text        NOT NULL DEFAULT 'GHS',

  cover_image_url text,

  -- null means unlimited. Only meaningful for physical stock.
  stock         integer,
  requires_shipping boolean NOT NULL DEFAULT false,

  category      text,
  subject       text,
  grades        text[]      NOT NULL DEFAULT '{}',   -- empty means every grade
  tags          text[]      NOT NULL DEFAULT '{}',
  author        text,

  featured      boolean     NOT NULL DEFAULT false,
  status        text        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'archived')),
  sort_order    integer     NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_products_status_idx ON marketplace_products(status);
CREATE INDEX IF NOT EXISTS mp_products_kind_idx   ON marketplace_products(kind);
CREATE INDEX IF NOT EXISTS mp_products_link_idx   ON marketplace_products(links_to_type, links_to_id);

-- The file behind a download lives in its own table with no read policy at
-- all. Keeping it as a column on the product would have meant the catalogue
-- policy handing the file to anyone who opened the shop, and a select('*')
-- somewhere down the line would have leaked it without anybody noticing.
-- Here the only way to the file is get_my_download, which checks ownership.
CREATE TABLE IF NOT EXISTS product_files (
  product_id uuid PRIMARY KEY REFERENCES marketplace_products(id) ON DELETE CASCADE,
  file_url   text NOT NULL,
  file_name  text,
  file_size  integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Cart ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cart_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  quantity   integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx ON cart_items(user_id);

-- ── Orders ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference     text UNIQUE NOT NULL,

  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),

  subtotal      numeric(10,2) NOT NULL DEFAULT 0,
  shipping_fee  numeric(10,2) NOT NULL DEFAULT 0,
  total         numeric(10,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'GHS',

  payment_reference text,
  payment_method    text,          -- card | momo | offline
  paid_at       timestamptz,
  paid_by       text,              -- who recorded it, for payments taken offline

  -- Only collected when the order contains something physical
  delivery_name    text,
  delivery_phone   text,
  delivery_address text,
  delivery_city    text,
  delivery_note    text,

  fulfilment    text NOT NULL DEFAULT 'none'
                CHECK (fulfilment IN ('none', 'pending', 'dispatched', 'delivered')),
  dispatched_at timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_idx   ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

-- Line items keep their own copy of the title and price. A product renamed or
-- repriced next term must not rewrite what someone bought last term.
CREATE TABLE IF NOT EXISTS order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES marketplace_products(id) ON DELETE SET NULL,

  title         text NOT NULL,
  kind          text NOT NULL,
  links_to_type text,
  links_to_id   uuid,

  unit_price    numeric(10,2) NOT NULL,
  quantity      integer NOT NULL DEFAULT 1,
  line_total    numeric(10,2) NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

-- ── Ownership ──────────────────────────────────────────────────────────────
--
-- The single answer to "can this student open this thing". A free course
-- added from the Learning Hub and a paid book both land here, so every screen
-- asks one question rather than each inventing its own rule.

CREATE TABLE IF NOT EXISTS entitlements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  item_type  text NOT NULL CHECK (item_type IN ('course', 'assessment', 'product')),
  item_id    uuid NOT NULL,

  source     text NOT NULL DEFAULT 'purchase'
             CHECK (source IN ('purchase', 'free', 'admin', 'registration')),
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,

  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS entitlements_user_idx ON entitlements(user_id);

-- One live entitlement per thing per person. Revoked rows are kept as history,
-- so the index only covers the live ones.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_unique_live
  ON entitlements(user_id, item_type, item_id)
  WHERE revoked_at IS NULL;

-- ── Row level security ─────────────────────────────────────────────────────

ALTER TABLE marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements         ENABLE ROW LEVEL SECURITY;

-- Anyone may browse the shop, signed in or not. Draft and archived rows are
-- invisible, which is what makes a product safe to build up over several days.
DROP POLICY IF EXISTS "active products are browsable" ON marketplace_products;
CREATE POLICY "active products are browsable"
  ON marketplace_products FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- product_files gets no policy of any kind on purpose. RLS is enabled and
-- nothing is granted, so anon and authenticated read nothing from it. The
-- admin server's service role bypasses RLS and writes it directly.

DROP POLICY IF EXISTS "own cart" ON cart_items;
CREATE POLICY "own cart"
  ON cart_items FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own orders readable" ON orders;
CREATE POLICY "own orders readable"
  ON orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Deliberately no INSERT or UPDATE policy on orders. Orders are created by
-- checkout_cart and settled by confirm_order_payment, both of which run as
-- definer. A student cannot write an order row directly, so they cannot set
-- their own total or mark themselves paid.

DROP POLICY IF EXISTS "own order items readable" ON order_items;
CREATE POLICY "own order items readable"
  ON order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "own entitlements readable" ON entitlements;
CREATE POLICY "own entitlements readable"
  ON entitlements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ── Order references ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _shop_next_reference()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  candidate text;
  tries     integer := 0;
BEGIN
  LOOP
    candidate := 'GO-' || to_char(now(), 'YYMM') || '-' ||
                 upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE reference = candidate);
    tries := tries + 1;
    IF tries > 20 THEN
      RAISE EXCEPTION 'Could not allocate an order reference.';
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION _shop_next_reference() FROM PUBLIC, anon, authenticated;

-- ── Adding to the cart ─────────────────────────────────────────────────────
--
-- Goes through a function rather than a plain insert so that buying something
-- twice is caught here, at the point the student can still be told about it,
-- rather than at checkout.

CREATE OR REPLACE FUNCTION add_to_cart(p_product_id uuid, p_quantity integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  p   marketplace_products;
  qty integer := GREATEST(1, COALESCE(p_quantity, 1));
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in to start a cart.');
  END IF;

  SELECT * INTO p FROM marketplace_products WHERE id = p_product_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'That item is no longer on sale.');
  END IF;

  IF p.stock IS NOT NULL AND p.stock < qty THEN
    RETURN jsonb_build_object('error',
      CASE WHEN p.stock = 0 THEN 'That one is out of stock.'
           ELSE 'Only ' || p.stock || ' left in stock.' END);
  END IF;

  -- Access bought once is access for good, so a second copy is never useful
  IF p.links_to_type IS NOT NULL AND EXISTS (
    SELECT 1 FROM entitlements e
    WHERE e.user_id = uid AND e.item_type = p.links_to_type
      AND e.item_id = p.links_to_id AND e.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'You already have this. Look under My Learning.');
  END IF;

  -- Digital goods are bought once, physical ones can be bought in quantity
  IF p.kind IN ('course', 'assessment', 'download') THEN
    INSERT INTO cart_items (user_id, product_id, quantity)
    VALUES (uid, p.id, 1)
    ON CONFLICT (user_id, product_id) DO NOTHING;
  ELSE
    INSERT INTO cart_items (user_id, product_id, quantity)
    VALUES (uid, p.id, qty)
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET quantity = LEAST(
      cart_items.quantity + qty,
      COALESCE(p.stock, cart_items.quantity + qty)
    );
  END IF;

  RETURN jsonb_build_object('ok', true,
    'count', (SELECT COALESCE(SUM(quantity), 0) FROM cart_items WHERE user_id = uid));
END;
$$;

GRANT EXECUTE ON FUNCTION add_to_cart(uuid, integer) TO authenticated;

-- ── Checkout ───────────────────────────────────────────────────────────────
--
-- Turns the cart into an order priced from the products table. Returns the
-- order so the caller can hand the total to Paystack. Nothing is granted yet:
-- an order at this point is an intention to pay.
--
-- A cart that costs nothing skips payment entirely and is settled here, which
-- is what makes "add this free resource to my profile" a single tap.

CREATE OR REPLACE FUNCTION checkout_cart(p_delivery jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid        uuid := auth.uid();
  order_row  orders;
  needs_ship boolean := false;
  sum_total  numeric(10,2) := 0;
  line_count integer := 0;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in to check out.');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(p.price * c.quantity), 0),
         bool_or(p.requires_shipping)
    INTO line_count, sum_total, needs_ship
    FROM cart_items c
    JOIN marketplace_products p ON p.id = c.product_id AND p.status = 'active'
   WHERE c.user_id = uid;

  IF line_count = 0 THEN
    RETURN jsonb_build_object('error', 'Your cart is empty.');
  END IF;

  IF needs_ship AND COALESCE(trim(p_delivery->>'address'), '') = '' THEN
    RETURN jsonb_build_object('error', 'We need a delivery address for the printed items.');
  END IF;

  -- Stock is checked again here. Between adding to the cart and paying, the
  -- last copy may have gone to someone else.
  IF EXISTS (
    SELECT 1 FROM cart_items c
    JOIN marketplace_products p ON p.id = c.product_id
    WHERE c.user_id = uid AND p.stock IS NOT NULL AND p.stock < c.quantity
  ) THEN
    RETURN jsonb_build_object('error', 'Something in your cart just sold out. Check the quantities.');
  END IF;

  INSERT INTO orders (
    user_id, reference, subtotal, shipping_fee, total, currency,
    delivery_name, delivery_phone, delivery_address, delivery_city, delivery_note,
    fulfilment
  ) VALUES (
    uid, _shop_next_reference(), sum_total, 0, sum_total, 'GHS',
    NULLIF(trim(COALESCE(p_delivery->>'name', '')), ''),
    NULLIF(trim(COALESCE(p_delivery->>'phone', '')), ''),
    NULLIF(trim(COALESCE(p_delivery->>'address', '')), ''),
    NULLIF(trim(COALESCE(p_delivery->>'city', '')), ''),
    NULLIF(trim(COALESCE(p_delivery->>'note', '')), ''),
    CASE WHEN needs_ship THEN 'pending' ELSE 'none' END
  ) RETURNING * INTO order_row;

  INSERT INTO order_items (
    order_id, product_id, title, kind, links_to_type, links_to_id,
    unit_price, quantity, line_total
  )
  SELECT order_row.id, p.id, p.title, p.kind, p.links_to_type, p.links_to_id,
         p.price, c.quantity, p.price * c.quantity
    FROM cart_items c
    JOIN marketplace_products p ON p.id = c.product_id
   WHERE c.user_id = uid;

  DELETE FROM cart_items WHERE user_id = uid;

  -- Nothing to pay, so nothing to wait for
  IF sum_total <= 0 THEN
    PERFORM _shop_settle_order(order_row.id, NULL, 'free');
    SELECT * INTO order_row FROM orders WHERE id = order_row.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(order_row));
END;
$$;

GRANT EXECUTE ON FUNCTION checkout_cart(jsonb) TO authenticated;

-- ── Settling an order ──────────────────────────────────────────────────────
--
-- Shared by the student card path and the admin offline path so that both
-- grant access and move stock in exactly the same way. Idempotent: paying an
-- already paid order changes nothing rather than granting twice.

CREATE OR REPLACE FUNCTION _shop_settle_order(
  p_order_id uuid,
  p_reference text,
  p_method text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'We could not find that order.');
  END IF;
  IF o.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'alreadyPaid', true);
  END IF;

  UPDATE orders SET
    status            = 'paid',
    payment_reference = NULLIF(trim(COALESCE(p_reference, '')), ''),
    payment_method    = p_method,
    paid_at           = now(),
    updated_at        = now()
  WHERE id = o.id;

  -- Access to anything that points at a course or an assessment
  INSERT INTO entitlements (user_id, item_type, item_id, source, order_id)
  SELECT o.user_id, oi.links_to_type, oi.links_to_id, 'purchase', o.id
    FROM order_items oi
   WHERE oi.order_id = o.id AND oi.links_to_type IS NOT NULL AND oi.links_to_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Access to the product itself, which is what a download or a book is
  INSERT INTO entitlements (user_id, item_type, item_id, source, order_id)
  SELECT o.user_id, 'product', oi.product_id, 'purchase', o.id
    FROM order_items oi
   WHERE oi.order_id = o.id AND oi.product_id IS NOT NULL AND oi.links_to_type IS NULL
  ON CONFLICT DO NOTHING;

  UPDATE marketplace_products p SET stock = GREATEST(0, p.stock - oi.quantity)
    FROM order_items oi
   WHERE oi.order_id = o.id AND oi.product_id = p.id AND p.stock IS NOT NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION _shop_settle_order(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- The student's own card payment. Narrow on purpose: it can move one of their
-- own orders from pending to paid and do nothing else.
CREATE OR REPLACE FUNCTION confirm_order_payment(p_order_id uuid, p_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in first.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id AND user_id = uid) THEN
    RETURN jsonb_build_object('error', 'We could not find that order.');
  END IF;
  RETURN _shop_settle_order(p_order_id, p_reference, 'card');
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_order_payment(uuid, text) TO authenticated;

-- ── Claiming something free ────────────────────────────────────────────────
--
-- The Learning Hub's "add to my learning". Refuses anything with a price on
-- it, so it can never be used as a way around checkout.

CREATE OR REPLACE FUNCTION claim_free_item(p_item_type text, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid  uuid := auth.uid();
  cost numeric;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in to save this to your learning.');
  END IF;

  IF p_item_type = 'course' THEN
    -- courses.cost has carried both numbers and strings like "GHS 200" over
    -- the years, so it is scrubbed to digits rather than cast straight across
    SELECT COALESCE(NULLIF(regexp_replace(COALESCE(c.cost::text, '0'), '[^0-9.]', '', 'g'), '')::numeric, 0)
      INTO cost FROM courses c WHERE c.id = p_item_id AND c.publish = true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'That course is not available.');
    END IF;
  ELSIF p_item_type = 'assessment' THEN
    -- Assessments carry no price of their own. Anything sold is sold through
    -- a product row, so a bare assessment is free by definition.
    cost := 0;
    IF NOT EXISTS (SELECT 1 FROM exams WHERE id = p_item_id AND publish = true) THEN
      RETURN jsonb_build_object('error', 'That assessment is not available.');
    END IF;
  ELSE
    RETURN jsonb_build_object('error', 'That cannot be added this way.');
  END IF;

  IF cost > 0 THEN
    RETURN jsonb_build_object('error', 'This one is paid. Add it to your cart instead.');
  END IF;

  INSERT INTO entitlements (user_id, item_type, item_id, source)
  VALUES (uid, p_item_type, p_item_id, 'free')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_free_item(text, uuid) TO authenticated;

-- Removing it again, so adding something is not a one way door
CREATE OR REPLACE FUNCTION drop_free_item(p_item_type text, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in first.');
  END IF;
  -- Only what they added themselves. A purchase is not undone by a tap.
  DELETE FROM entitlements
   WHERE user_id = uid AND item_type = p_item_type AND item_id = p_item_id
     AND source = 'free';
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION drop_free_item(text, uuid) TO authenticated;

-- ── The file behind a download ─────────────────────────────────────────────
--
-- The only way to product_files from a student session. Ownership first, file
-- second, so an unpaid link is never one guessed URL away.

CREATE OR REPLACE FUNCTION get_my_download(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  f   product_files;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in first.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM entitlements
     WHERE user_id = uid AND item_type = 'product' AND item_id = p_product_id
       AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'You do not have this one yet.');
  END IF;

  SELECT * INTO f FROM product_files WHERE product_id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'There is no file on this item yet. Contact us.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'url', f.file_url, 'name', f.file_name);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_download(uuid) TO authenticated;

-- ── Admin ──────────────────────────────────────────────────────────────────
--
-- Reached only through the admin server's service role.

CREATE OR REPLACE FUNCTION admin_settle_order(
  p_order_id uuid,
  p_reference text DEFAULT NULL,
  p_actor text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE res jsonb;
BEGIN
  res := _shop_settle_order(p_order_id, p_reference, 'offline');
  UPDATE orders SET paid_by = p_actor WHERE id = p_order_id AND status = 'paid';
  RETURN res;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_settle_order(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_settle_order(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION admin_set_entitlement(
  p_user_id uuid,
  p_item_type text,
  p_item_id uuid,
  p_granted boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_granted THEN
    INSERT INTO entitlements (user_id, item_type, item_id, source)
    VALUES (p_user_id, p_item_type, p_item_id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE entitlements SET revoked_at = now()
     WHERE user_id = p_user_id AND item_type = p_item_type
       AND item_id = p_item_id AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_entitlement(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_set_entitlement(uuid, text, uuid, boolean) TO service_role;

-- ── Keep updated_at honest ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _shop_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS mp_products_touch ON marketplace_products;
CREATE TRIGGER mp_products_touch BEFORE UPDATE ON marketplace_products
  FOR EACH ROW EXECUTE FUNCTION _shop_touch();

DROP TRIGGER IF EXISTS orders_touch ON orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION _shop_touch();

-- Verify:
--   SELECT COUNT(*) FROM marketplace_products;
--   SELECT proname FROM pg_proc WHERE proname LIKE '%cart%' OR proname LIKE '%order%';
