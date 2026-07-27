"use client";

import { useEffect, useState } from "react";
import { CardPhotoManager } from "@/components/records/card-photo-manager";

type InventoryImage = { key: string; previewUrl: string; position: number };

export function CardInventoryImages({
  canUpload,
  cardName,
  copyId,
  isPreview = false,
  onImagesChange,
}: {
  canUpload: boolean;
  cardName: string;
  copyId: string;
  isPreview?: boolean;
  onImagesChange?: (images: InventoryImage[]) => void;
}) {
  const [configured, setConfigured] = useState(true);
  const [images, setImages] = useState<InventoryImage[]>([]);
  const [loading, setLoading] = useState(!isPreview);
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isPreview) return;
    let active = true;
    void fetch(`/api/inventory/card-images?copyId=${encodeURIComponent(copyId)}`)
      .then(async (response) => {
        const payload = await response.json() as {
          configured?: boolean;
          images?: InventoryImage[];
          message?: string;
        };
        if (!response.ok) throw new Error(payload.message || "Card photos could not be loaded.");
        if (!active) return;
        setConfigured(payload.configured !== false);
        setImages(payload.images ?? []);
      })
      .catch((error) => {
        if (active) {
          const nextMessage = error instanceof Error ? error.message : "Card photos could not be loaded.";
          setMessage(nextMessage === "That physical card Copy was not found." ? "This Copy is no longer available. Go back to inventory and choose another Copy." : nextMessage);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copyId, isPreview]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setMessage(null);
    const next = [...images];
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("copyId", copyId);
      form.append("image", file);
      try {
        const response = await fetch("/api/inventory/card-images", { body: form, method: "POST" });
        const payload = await response.json() as { image?: InventoryImage; message?: string };
        if (!response.ok || !payload.image) throw new Error(payload.message || "The card image could not be uploaded.");
        next.push(payload.image);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be uploaded."}`);
      }
    }
    setImages(next);
    onImagesChange?.(next);
    if (failures.length) setMessage(failures.join(" "));
    setUploading(false);
  }

  async function remove(imageKey: string) {
    setRemovingKey(imageKey);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/card-images", {
        body: JSON.stringify({ copyId, key: imageKey }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await response.json() as { message?: string; removed?: boolean };
      if (!response.ok || !payload.removed) throw new Error(payload.message || "The card image could not be removed.");
      const next = images
        .filter((image) => image.key !== imageKey)
        .map((image, position) => ({ ...image, position }));
      setImages(next);
      onImagesChange?.(next);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The card image could not be removed.");
      return false;
    } finally {
      setRemovingKey(null);
    }
  }

  async function reorder(keys: string[]) {
    const previousImages = images;
    const imageByKey = new Map(images.map((image) => [image.key, image]));
    const optimisticImages = keys
      .map((key, position) => {
        const image = imageByKey.get(key);
        return image ? { ...image, position } : null;
      })
      .filter((image): image is InventoryImage => image !== null);
    if (optimisticImages.length === images.length) setImages(optimisticImages);
    setReordering(true);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/card-images", {
        body: JSON.stringify({ copyId, keys }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json() as { images?: InventoryImage[]; message?: string };
      if (!response.ok || !payload.images) throw new Error(payload.message || "Photo order could not be saved.");
      setImages(payload.images);
      onImagesChange?.(payload.images);
      return true;
    } catch (error) {
      setImages(previousImages);
      setMessage(error instanceof Error ? error.message : "Photo order could not be saved.");
      return false;
    } finally {
      setReordering(false);
    }
  }

  return (
    <CardPhotoManager
      canManage={canUpload}
      cardName={cardName}
      changing={uploading || reordering || Boolean(removingKey)}
      configured={configured}
      description="Private photos saved against this physical Copy."
      emptyText="No photos uploaded for this Copy yet."
      id={`card-images-${copyId}`}
      images={images.map((image) => ({ id: image.key, previewUrl: image.previewUrl }))}
      loading={loading}
      message={message}
      onRemove={remove}
      onReorder={reorder}
      onUpload={upload}
      previewSubtitle="Saved privately in S3"
      previewNotice={isPreview ? "Upload photos or take a photo on your phone once this Copy is saved in your live collection. This preview does not store photos." : undefined}
      removalDescription="It will also be removed from the private S3 archive."
      removalTitle="Remove this photo from the Copy?"
      removingId={removingKey}
      reordering={reordering}
      storageWarning="Private card-photo storage is not configured on this server."
      title="Card photos"
      uploading={uploading}
    />
  );
}
