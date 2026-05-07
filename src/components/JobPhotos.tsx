import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Photo {
  id: string;
  storage_path: string;
  type: string;
  url?: string;
}

export function JobPhotos({ jobId, type, photos, userId }: { jobId: string; type: "before" | "after"; photos: Photo[]; userId: string }) {
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    (async () => {
      const map: Record<string, string> = {};
      for (const p of photos) {
        const { data } = await supabase.storage.from("job-photos").createSignedUrl(p.storage_path, 3600);
        if (data?.signedUrl) map[p.id] = data.signedUrl;
      }
      setSigned(map);
    })();
  }, [photos]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${jobId}/${type}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("job_photos").insert({
        job_id: jobId,
        type,
        storage_path: path,
        uploaded_by: userId,
      });
      if (insErr) throw insErr;
      toast.success(`${type === "before" ? "Before" : "After"} photo added`);
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <a key={p.id} href={signed[p.id]} target="_blank" rel="noreferrer" className="aspect-square rounded-md overflow-hidden bg-muted">
            {signed[p.id] && <img src={signed[p.id]} alt={type} className="w-full h-full object-cover" />}
          </a>
        ))}
        <label className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center text-xs text-muted-foreground gap-1 cursor-pointer hover:bg-muted">
          <Camera className="h-5 w-5" />
          {uploading ? "…" : "Add"}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      </div>
    </div>
  );
}