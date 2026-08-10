-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE — the gifted-files bucket
--
-- Idempotent. Safe to run on a live install, and safe to run twice.
--
-- Who needs what
-- --------------
-- WRITING: every upload goes through /api/upload-file on the admin server,
-- using the service role key. That role bypasses storage RLS entirely, so no
-- INSERT policy is required and adding one would change nothing. The browser
-- never uploads directly.
--
-- READING: this is where public access actually matters. Question images are
-- fetched by students, and certificate backgrounds are fetched server side by
-- the PDF renderer. Both use the plain public URL, so the bucket has to be
-- public or those requests come back 404 even though the upload succeeded.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('gifted-files', 'gifted-files', true, 10485760)   -- 10MB ceiling
ON CONFLICT (id) DO UPDATE
  SET public          = true,
      file_size_limit = GREATEST(storage.buckets.file_size_limit, 10485760);

-- allowed_mime_types is deliberately left unset. Course steps upload PDFs and
-- other documents through this same bucket, and a whitelist tuned for images
-- would quietly break them.

-- A public bucket serves objects without needing a SELECT policy, but an
-- explicit one is added so the intent is visible to anyone reading the schema
-- rather than inferred from a boolean column.
DROP POLICY IF EXISTS "gifted-files public read" ON storage.objects;
CREATE POLICY "gifted-files public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'gifted-files');

-- Verify: should return one row, public = true
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'gifted-files';
