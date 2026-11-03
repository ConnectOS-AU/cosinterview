import "server-only";
import { demoMode } from "./demo";
import { supabaseAdmin } from "./supabase/admin";

// The candidate's LinkedIn profile as a PDF, uploaded by the recruiter (LinkedIn
// itself can't be read automatically). One per booking, in
// cos_recruitment_linkedin_pdfs; the candidate overview compares it with the
// resume (lib/worker/review.ts).

export const MAX_LINKEDIN_PDF_BYTES = 4 * 1024 * 1024;

export type LinkedinPdf = { fileName: string; sizeBytes: number; uploadedBy: string; uploadedAt: string };
type WithContent = LinkedinPdf & { base64: string };

const store = globalThis as typeof globalThis & { __cosrecLinkedinPdfs?: Map<string, WithContent> };

export async function getLinkedinPdf(bookingId: string): Promise<LinkedinPdf | null> {
  if (demoMode()) return store.__cosrecLinkedinPdfs?.get(bookingId) ?? null;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_linkedin_pdfs")
    .select("file_name, size_bytes, uploaded_by, uploaded_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`Reading the LinkedIn PDF failed: ${error.message}`);
  return data ? { fileName: data.file_name, sizeBytes: data.size_bytes, uploadedBy: data.uploaded_by, uploadedAt: data.uploaded_at } : null;
}

export async function linkedinPdfContent(bookingId: string): Promise<{ fileName: string; base64: string } | null> {
  if (demoMode()) return store.__cosrecLinkedinPdfs?.get(bookingId) ?? null;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_linkedin_pdfs")
    .select("file_name, content")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`Reading the LinkedIn PDF failed: ${error.message}`);
  return data ? { fileName: data.file_name, base64: data.content } : null;
}

export async function saveLinkedinPdf(bookingId: string, fileName: string, bytes: Buffer, uploadedBy: string): Promise<LinkedinPdf> {
  const pdf: LinkedinPdf = { fileName, sizeBytes: bytes.length, uploadedBy, uploadedAt: new Date().toISOString() };
  const base64 = bytes.toString("base64");
  if (demoMode()) {
    (store.__cosrecLinkedinPdfs ??= new Map()).set(bookingId, { ...pdf, base64 });
    return pdf;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_linkedin_pdfs").upsert({
    booking_id: bookingId,
    file_name: pdf.fileName,
    size_bytes: pdf.sizeBytes,
    content: base64,
    uploaded_by: pdf.uploadedBy,
    uploaded_at: pdf.uploadedAt,
  });
  if (error) throw new Error(`Saving the LinkedIn PDF failed: ${error.message}`);
  return pdf;
}

export async function removeLinkedinPdf(bookingId: string): Promise<void> {
  if (demoMode()) {
    store.__cosrecLinkedinPdfs?.delete(bookingId);
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_linkedin_pdfs").delete().eq("booking_id", bookingId);
  if (error) throw new Error(`Removing the LinkedIn PDF failed: ${error.message}`);
}
