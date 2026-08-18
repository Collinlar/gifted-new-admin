"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import ImageField from "@/components/ui/ImageField";
import { uploadFile } from "@/lib/upload";
import api from "@/lib/api";
import {
  Plus, Search, Trash2, Globe, Lock, Package, Download, BookOpen,
  FileText, Layers, X, Paperclip, Link2, Loader2,
} from "lucide-react";

// The shop, from the admin side.
//
// Two things live here: what is on sale, and what has been bought. They are
// tabs on one page rather than two entries in the sidebar because the
// question "did that sell" is asked about a product, not in the abstract.
//
// Publishing works the same way it does on assessments: a switch on the row.
// A product sitting in draft is invisible to students, enforced by the row
// level policy rather than by the list remembering to filter.

interface ProductFile { file_url: string; file_name: string | null }
interface Product {
  id: string; sku?: string | null;
  title: string; subtitle?: string; description?: string;
  kind: "book" | "download" | "course" | "assessment" | "bundle";
  links_to_type?: string | null; links_to_id?: string | null;
  price: number; compare_at?: number | null; currency: string;
  cover_image_url?: string | null;
  stock?: number | null; requires_shipping: boolean;
  category?: string; subject?: string; author?: string;
  grades: string[]; tags: string[];
  featured: boolean; status: "draft" | "active" | "archived";
  file?: ProductFile | null;
  sold: number;
}

interface OrderItem { id: string; title: string; quantity: number; line_total: number }
interface Buyer { first_name?: string; last_name?: string; email?: string; mobile_number?: string }
interface Order {
  id: string; reference: string; status: string;
  total: number; currency: string;
  payment_reference?: string | null; paid_at?: string | null;
  delivery_name?: string | null; delivery_phone?: string | null;
  delivery_address?: string | null; delivery_city?: string | null; delivery_note?: string | null;
  fulfilment: "none" | "pending" | "dispatched" | "delivered";
  created_at: string;
  order_items: OrderItem[];
  buyer: Buyer | null;
}

const KIND_ICON = {
  book: Package, download: Download, course: BookOpen,
  assessment: FileText, bundle: Layers,
} as const;

const money = (n: number, c = "GHS") =>
  `${c === "GHS" ? "GH₵" : c + " "}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function ShopPage() {
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const [p, o] = await Promise.all([
        api.get("/shop-products"),
        api.get("/shop-orders"),
      ]);
      setProducts(p.data.products || []);
      setOrders(o.data.orders || []);
    } catch (e) {
      // The real message. When this reads "relation marketplace_products does
      // not exist", the migration has not been run and that is worth knowing.
      setError(
        (e as { response?: { data?: { error?: string } }; message?: string })
          .response?.data?.error ||
        (e as Error).message ||
        "Could not load the shop."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revenue = orders
    .filter((o) => o.status === "paid")
    .reduce((n, o) => n + Number(o.total || 0), 0);
  const toPack = orders.filter((o) => o.status === "paid" && o.fulfilment === "pending").length;

  return (
    <AuthGuard>
      <DashboardShell title="Shop">
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
              {notice}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="On sale" value={products.filter((p) => p.status === "active").length} />
            <Stat label="Draft" value={products.filter((p) => p.status === "draft").length} />
            <Stat label="Paid orders" value={orders.filter((o) => o.status === "paid").length} />
            <Stat label="Taken" value={money(revenue)} />
          </div>

          <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
            {([
              ["products", `Products (${products.length})`],
              ["orders", `Orders (${orders.length})${toPack ? ` · ${toPack} to pack` : ""}`],
            ] as const).map(([v, label]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === v ? "bg-primary text-white shadow-sm" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <Spinner text="Loading the shop..." />
          ) : tab === "products" ? (
            <Products items={products} reload={load} setNotice={setNotice} setError={setError} />
          ) : (
            <Orders items={orders} reload={load} setNotice={setNotice} setError={setError} />
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-bold text-ink mt-0.5">{value}</p>
    </div>
  );
}

// ── Products ───────────────────────────────────────────────────────────────

function Products({ items, reload, setNotice, setError }: {
  items: Product[]; reload: () => Promise<void>;
  setNotice: (s: string) => void; setError: (s: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "draft" | "archived">("all");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (!q) return true;
      return [p.title, p.subtitle, p.author, p.sku]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [items, search, status]);

  const setStatusOf = async (p: Product, next: "active" | "draft") => {
    setBusy(true); setNotice(""); setError("");
    try {
      await api.put(`/update-product/${p.id}`, { status: next });
      setNotice(next === "active"
        ? "On sale. Students can see it now."
        : "Taken off sale. Hidden from students.");
      await reload();
    } catch (e) {
      setError(msg(e, "Could not change that."));
    } finally { setBusy(false); }
  };

  const remove = async (p: Product) => {
    if (!confirm(p.sold > 0
      ? `${p.title} has sold ${p.sold}. It will be archived rather than deleted so past orders keep their details. Continue?`
      : `Delete ${p.title}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await api.delete(`/delete-product/${p.id}`);
      setNotice(res.data.archived ? "Archived. Past orders keep their details." : "Deleted.");
      await reload();
    } catch (e) {
      setError(msg(e, "Could not remove that."));
    } finally { setBusy(false); }
  };

  const counts = {
    all: items.length,
    active: items.filter((p) => p.status === "active").length,
    draft: items.filter((p) => p.status === "draft").length,
    archived: items.filter((p) => p.status === "archived").length,
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-2 flex-wrap">
          {(["all", "active", "draft", "archived"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                status === s ? "bg-primary text-white border-primary"
                             : "border-border text-muted hover:border-primary hover:text-primary"}`}>
              {s === "all" ? "Everything" : s === "active" ? "On sale" : s === "draft" ? "Draft" : "Archived"}
              <span className="ml-1.5 opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary w-44" />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setLinking(true)}>
            <Link2 size={14} /> List a course
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> New product
          </Button>
        </div>
      </div>

      <Card padding={false}>
        {shown.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-muted text-sm">
              {search ? `Nothing matching "${search}"` : "Nothing here yet."}
            </p>
            <Button size="sm" className="mt-4" onClick={() => setEditing("new")}>
              <Plus size={14} /> Add the first product
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-muted font-medium">Item</th>
                <th className="text-left px-5 py-3 text-muted font-medium">Price</th>
                <th className="text-left px-5 py-3 text-muted font-medium">Stock</th>
                <th className="text-left px-5 py-3 text-muted font-medium">Sold</th>
                <th className="text-left px-5 py-3 text-muted font-medium">Visible to students</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const Icon = KIND_ICON[p.kind] || Package;
                return (
                  <tr key={p.id}
                    className={`border-b border-border last:border-0 hover:bg-surface/60 ${p.status === "active" ? "" : "bg-surface/30"}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-surface grid place-items-center overflow-hidden shrink-0">
                          {p.cover_image_url
                            ? <img src={p.cover_image_url} alt="" className="w-full h-full object-cover" />
                            : <Icon size={16} className="text-subtle" />}
                        </div>
                        <div className="min-w-0">
                          <button onClick={() => setEditing(p)} className="font-medium text-ink hover:text-primary text-left">
                            {p.title}
                          </button>
                          <p className="text-xs text-subtle capitalize">
                            {p.kind}
                            {p.file ? " · file attached" : ""}
                            {p.status === "archived" ? " · archived" : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {Number(p.price) <= 0 ? "Free" : money(p.price, p.currency)}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {p.stock === null || p.stock === undefined
                        ? "—"
                        : <span className={p.stock === 0 ? "text-danger font-medium" : ""}>{p.stock}</span>}
                    </td>
                    <td className="px-5 py-3 text-muted">{p.sold || "—"}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => setStatusOf(p, p.status === "active" ? "draft" : "active")}
                        disabled={busy || p.status === "archived"}
                        title={p.status === "active" ? "Take off sale" : "Put on sale"}
                        className="flex items-center gap-2 disabled:opacity-50">
                        <span className={`w-9 h-5 rounded-full relative flex items-center shrink-0 transition-colors ${
                          p.status === "active" ? "bg-emerald-500" : "bg-border"}`}>
                          <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            p.status === "active" ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                        <span className={`text-xs font-medium ${p.status === "active" ? "text-emerald-700" : "text-muted"}`}>
                          {p.status === "active" ? "On sale" : p.status === "archived" ? "Archived" : "Draft"}
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>Edit</Button>
                        <button onClick={() => remove(p)}
                          className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <ProductEditor
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (m) => { setEditing(null); setNotice(m); await reload(); }}
        />
      )}
      {linking && (
        <LinkPicker
          onClose={() => setLinking(false)}
          onListed={async (m) => { setLinking(false); setNotice(m); await reload(); }}
        />
      )}
    </>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────

const BLANK = {
  title: "", subtitle: "", description: "", kind: "book",
  price: "", compare_at: "", currency: "GHS",
  cover_image_url: "", stock: "", requires_shipping: true,
  author: "", category: "", subject: "",
  grades: [] as string[], tags: [] as string[],
  featured: false, status: "draft",
  file_url: "", file_name: "",
};

function ProductEditor({ product, onClose, onSaved }: {
  product: Product | null;
  onClose: () => void;
  onSaved: (notice: string) => Promise<void>;
}) {
  const [f, setF] = useState<Record<string, unknown>>(() =>
    product
      ? {
          ...BLANK, ...product,
          price: String(product.price ?? ""),
          compare_at: product.compare_at == null ? "" : String(product.compare_at),
          stock: product.stock == null ? "" : String(product.stock),
          file_url: product.file?.file_url || "",
          file_name: product.file?.file_name || "",
        }
      : BLANK
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const kind = f.kind as string;

  // The two things that follow from what it is, so nobody has to remember
  // that a printed book needs an address and a download does not.
  useEffect(() => {
    if (kind === "book") set("requires_shipping", true);
    if (kind === "download" || kind === "course" || kind === "assessment") {
      set("requires_shipping", false);
    }
  }, [kind]);

  const save = async () => {
    if (!String(f.title).trim()) { setError("Give the item a title."); return; }
    if (kind === "download" && !f.file_url) {
      setError("A download needs a file. Attach one, or change the type.");
      return;
    }
    setSaving(true); setError("");
    try {
      if (product) {
        await api.put(`/update-product/${product.id}`, f);
        await onSaved("Saved.");
      } else {
        await api.post("/create-product", f);
        await onSaved(
          f.status === "active"
            ? "Created and on sale."
            : "Created as a draft. Flip the switch when it is ready to sell."
        );
      }
    } catch (e) {
      setError(msg(e, "Could not save that."));
    } finally { setSaving(false); }
  };

  return (
    <Modal title={product ? "Edit product" : "New product"} onClose={onClose} wide>
      {error && (
        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Label>What is it</Label>
          <div className="flex gap-2 flex-wrap">
            {(["book", "download", "course", "assessment", "bundle"] as const).map((k) => {
              const Icon = KIND_ICON[k];
              const on = kind === k;
              return (
                <button key={k} onClick={() => set("kind", k)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-1.5 capitalize transition-colors ${
                    on ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary"}`}>
                  <Icon size={14} /> {k}
                </button>
              );
            })}
          </div>
        </div>

        <Text label="Title" value={f.title} onChange={(v) => set("title", v)}
          placeholder="Kangaroo Maths past papers, 2020 to 2025" className="md:col-span-2" />
        <Text label="One line under the title" value={f.subtitle} onChange={(v) => set("subtitle", v)}
          placeholder="Six years of papers with full solutions" className="md:col-span-2" />

        <Text label="Price" value={f.price} onChange={(v) => set("price", v)}
          placeholder="0 for free" type="number" />
        <Text label="Was (shown struck through)" value={f.compare_at} onChange={(v) => set("compare_at", v)}
          placeholder="Leave empty if there is no discount" type="number" />

        <Text label="Author or publisher" value={f.author} onChange={(v) => set("author", v)}
          placeholder="ATDP" />
        <Text label="Subject" value={f.subject} onChange={(v) => set("subject", v)}
          placeholder="Mathematics" />

        {kind === "book" && (
          <Text label="How many in stock" value={f.stock} onChange={(v) => set("stock", v)}
            placeholder="Leave empty for unlimited" type="number" />
        )}

        <div className="md:col-span-2">
          <ImageField
            label="Cover"
            value={String(f.cover_image_url || "")}
            onChange={(url) => set("cover_image_url", url)}
          />
        </div>

        {(kind === "download" || kind === "bundle") && (
          <div className="md:col-span-2">
            <Label>The file buyers get</Label>
            {f.file_url ? (
              <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2.5">
                <Paperclip size={14} className="text-muted shrink-0" />
                <span className="text-sm text-ink truncate flex-1">
                  {String(f.file_name || f.file_url)}
                </span>
                <button onClick={() => { set("file_url", ""); set("file_name", ""); }}
                  className="text-subtle hover:text-danger p-1">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 border border-dashed border-border rounded-lg px-3 py-3 cursor-pointer hover:border-primary">
                {uploading
                  ? <Loader2 size={15} className="animate-spin text-primary" />
                  : <Paperclip size={15} className="text-muted" />}
                <span className="text-sm text-muted">
                  {uploading ? "Uploading..." : "Attach the PDF or zip"}
                </span>
                <input type="file" className="hidden" disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true); setError("");
                    try {
                      const url = await uploadFile(file);
                      set("file_url", url);
                      set("file_name", file.name);
                    } catch (err) {
                      setError(msg(err, "That file did not upload."));
                    } finally { setUploading(false); }
                  }} />
              </label>
            )}
            <p className="text-xs text-subtle mt-1.5">
              Buyers reach this through a check on what they own. The link is never
              part of the catalogue, so it cannot leak to someone who has not paid.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <Label>Description</Label>
          <textarea rows={4} value={String(f.description || "")}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What is in it, and who it is for."
            className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary" />
        </div>

        <TagList label="Grades it suits" values={f.grades as string[]}
          onChange={(v) => set("grades", v)} placeholder="Add a grade, then Enter" />
        <TagList label="Tags" values={f.tags as string[]}
          onChange={(v) => set("tags", v)} placeholder="Add a tag, then Enter" />

        <div className="md:col-span-2 flex flex-wrap gap-5 pt-1">
          <Check label="Show near the top of the shop" checked={!!f.featured}
            onChange={(v) => set("featured", v)} />
          {kind !== "book" && (
            <Check label="Needs delivering physically" checked={!!f.requires_shipping}
              onChange={(v) => set("requires_shipping", v)} />
          )}
          <Check
            label="On sale now"
            checked={f.status === "active"}
            onChange={(v) => set("status", v ? "active" : "draft")}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || uploading}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {product ? "Save changes" : "Create it"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Listing something that already exists ──────────────────────────────────

function LinkPicker({ onClose, onListed }: {
  onClose: () => void; onListed: (notice: string) => Promise<void>;
}) {
  const [courses, setCourses] = useState<{ id: string; title: string; cost?: string }[]>([]);
  const [exams, setExams] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/shop-linkables");
        setCourses(res.data.courses || []);
        setExams(res.data.assessments || []);
      } catch (e) {
        setError(msg(e, "Could not load what can be listed."));
      } finally { setLoading(false); }
    })();
  }, []);

  const list = async (type: "course" | "assessment", id: string, title: string) => {
    setBusy(id); setError("");
    try {
      await api.post("/list-in-shop", { type, id });
      await onListed(`${title} is now in the shop as a draft. Set the price, then put it on sale.`);
    } catch (e) {
      setError(msg(e, "Could not list that."));
      setBusy("");
    }
  };

  const q = search.trim().toLowerCase();
  const match = <T extends { title: string }>(rows: T[]) =>
    q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;

  return (
    <Modal title="Put an existing course or assessment on sale" onClose={onClose}>
      <p className="text-sm text-muted mb-4">
        This creates a shop listing pointing back at the original. There is only ever one
        copy of the course, and paying for the listing grants access to it.
      </p>

      {error && (
        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary" />
      </div>

      {loading ? <Spinner text="Loading..." /> : (
        <div className="space-y-5 max-h-[50vh] overflow-y-auto">
          <Group title="Courses" rows={match(courses)} busy={busy}
            onPick={(r) => list("course", r.id, r.title)}
            note={(r) => (r.cost ? `Currently GH₵${r.cost}` : "No price set")} />
          <Group title="Assessments" rows={match(exams)} busy={busy}
            onPick={(r) => list("assessment", r.id, r.title)} />
        </div>
      )}
    </Modal>
  );
}

function Group<T extends { id: string; title: string }>({ title, rows, busy, onPick, note }: {
  title: string; rows: T[]; busy: string;
  onPick: (r: T) => void; note?: (r: T) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
        {title} ({rows.length})
      </h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink truncate">{r.title}</p>
              {note && <p className="text-xs text-subtle">{note(r)}</p>}
            </div>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => onPick(r)}>
              {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              List it
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Orders ─────────────────────────────────────────────────────────────────

function Orders({ items, reload, setNotice, setError }: {
  items: Order[]; reload: () => Promise<void>;
  setNotice: (s: string) => void; setError: (s: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "unpaid" | "topack" | "paid">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((o) => {
      if (filter === "unpaid" && o.status !== "pending") return false;
      if (filter === "paid" && o.status !== "paid") return false;
      if (filter === "topack" && !(o.status === "paid" && o.fulfilment === "pending")) return false;
      if (!q) return true;
      const who = `${o.buyer?.first_name || ""} ${o.buyer?.last_name || ""} ${o.buyer?.email || ""}`;
      return o.reference.toLowerCase().includes(q) || who.toLowerCase().includes(q);
    });
  }, [items, filter, search]);

  const act = async (id: string, run: () => Promise<unknown>, message: string) => {
    setBusy(id); setNotice(""); setError("");
    try { await run(); setNotice(message); await reload(); }
    catch (e) { setError(msg(e, "That did not go through.")); }
    finally { setBusy(""); }
  };

  const counts = {
    all: items.length,
    unpaid: items.filter((o) => o.status === "pending").length,
    topack: items.filter((o) => o.status === "paid" && o.fulfilment === "pending").length,
    paid: items.filter((o) => o.status === "paid").length,
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-2 flex-wrap">
          {([
            ["all", "Everything"], ["unpaid", "Not paid"],
            ["topack", "To pack"], ["paid", "Paid"],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                filter === v ? "bg-primary text-white border-primary"
                             : "border-border text-muted hover:border-primary hover:text-primary"}`}>
              {label} <span className="ml-1 opacity-70">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Reference or buyer..."
            className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary w-52" />
        </div>
      </div>

      {shown.length === 0 ? (
        <Card><p className="text-sm text-muted text-center py-10">Nothing here.</p></Card>
      ) : (
        <div className="space-y-2.5">
          {shown.map((o) => (
            <Card key={o.id} padding={false}>
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {o.buyer
                        ? `${o.buyer.first_name || ""} ${o.buyer.last_name || ""}`.trim() || o.buyer.email
                        : "Unknown buyer"}
                    </p>
                    <p className="text-xs text-subtle font-mono mt-0.5">{o.reference}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {new Date(o.created_at).toLocaleString()}
                      {o.buyer?.email ? ` · ${o.buyer.email}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-ink">{money(o.total, o.currency)}</p>
                    <span className={`text-xs font-semibold ${
                      o.status === "paid" ? "text-emerald-700" : "text-amber-700"}`}>
                      {o.status === "paid" ? "Paid" : o.status === "pending" ? "Not paid" : o.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {o.order_items.map((it) => (
                    <div key={it.id} className="flex justify-between text-sm">
                      <span className="text-muted">
                        {it.title}{it.quantity > 1 ? ` × ${it.quantity}` : ""}
                      </span>
                      <span className="text-ink">{money(it.line_total, o.currency)}</span>
                    </div>
                  ))}
                </div>

                {o.delivery_address && (
                  <div className="mt-3 text-sm bg-surface rounded-lg px-3 py-2.5">
                    <p className="text-xs font-semibold text-muted mb-0.5">Deliver to</p>
                    <p className="text-ink">
                      {[o.delivery_name, o.delivery_phone].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-muted">
                      {[o.delivery_address, o.delivery_city].filter(Boolean).join(", ")}
                    </p>
                    {o.delivery_note && <p className="text-xs text-subtle mt-1">{o.delivery_note}</p>}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {o.status !== "paid" && (
                    // Most fees here arrive by mobile money rather than through
                    // the card form, so recording one has to be possible
                    // without pretending a Paystack transaction happened.
                    <Button size="sm" disabled={!!busy}
                      onClick={() => {
                        const ref = prompt("Payment reference, if you have one:") ?? "";
                        act(o.id,
                          () => api.put(`/settle-order/${o.id}`, { reference: ref }),
                          "Marked paid. Access granted and stock adjusted.");
                      }}>
                      {busy === o.id ? <Loader2 size={13} className="animate-spin" /> : null}
                      Record payment
                    </Button>
                  )}

                  {o.status === "paid" && o.fulfilment !== "none" && (
                    <div className="flex gap-1.5">
                      {(["pending", "dispatched", "delivered"] as const).map((stage) => (
                        <button key={stage} disabled={!!busy}
                          onClick={() => act(o.id,
                            () => api.put(`/order-fulfilment/${o.id}`, { fulfilment: stage }),
                            `Marked ${stage}.`)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border capitalize transition-colors ${
                            o.fulfilment === stage
                              ? "bg-primary text-white border-primary"
                              : "border-border text-muted hover:border-primary"}`}>
                          {stage === "pending" ? "To pack" : stage}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────

function msg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
         (e as Error)?.message || fallback;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-muted mb-1.5">{children}</label>;
}

function Text({ label, value, onChange, placeholder, type = "text", className = "" }: {
  label: string; value: unknown; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <input type={type} value={String(value ?? "")} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary" />
    </div>
  );
}

function Check({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TagList({ label, values, onChange, placeholder }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const list = Array.isArray(values) ? values : [];
  return (
    <div>
      <Label>{label}</Label>
      <div className="border border-border rounded-lg px-2 py-2 bg-card">
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {list.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 text-xs bg-surface px-2 py-1 rounded-md text-ink">
              {v}
              <button onClick={() => onChange(list.filter((x) => x !== v))} className="text-subtle hover:text-danger">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <input value={draft} placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = draft.trim();
            if (v && !list.includes(v)) onChange([...list, v]);
            setDraft("");
          }}
          className="w-full text-sm bg-transparent focus:outline-none px-1" />
      </div>
    </div>
  );
}

function Modal({ title, children, onClose, wide }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`bg-card rounded-xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-ink">
            <X size={17} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
