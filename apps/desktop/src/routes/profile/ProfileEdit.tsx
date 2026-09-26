// Editing your own public profile. Every field here becomes a signed
// PROFILE_UPDATE that anybody can read, which the notice says plainly.
import { Show, createResource, createSignal } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, Trash2 } from "lucide-solid";
import { Button, Field, Input, Textarea, Notice } from "~/components/ui";
import { Avatar } from "~/components/identity";
import { ipc, errText, type ProfileView } from "~/lib/ipc";
import { store } from "~/lib/store";
import { pickFile } from "~/lib/dialogs";

async function imageSrc(cid: string): Promise<string | null> {
  if (!cid) return null;
  try {
    return convertFileSrc(await ipc.peopleAvatar(cid));
  } catch {
    return null;
  }
}

export function ProfileEditor(props: { profile: ProfileView; onSaved: () => void | Promise<void> }) {
  const [name, setName] = createSignal(props.profile.display_name);
  const [bio, setBio] = createSignal(props.profile.bio);
  const [website, setWebsite] = createSignal(props.profile.website);
  const [country, setCountry] = createSignal(props.profile.country);
  const [avatarCid, setAvatarCid] = createSignal(props.profile.avatar_cid);
  const [bannerCid, setBannerCid] = createSignal(props.profile.banner_cid);
  const [busy, setBusy] = createSignal<"avatar" | "banner" | "save" | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const [avatar] = createResource(avatarCid, imageSrc);
  const [banner] = createResource(bannerCid, imageSrc);

  const pick = async (what: "avatar" | "banner") => {
    const [path] = await pickFile({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (!path) return;
    setBusy(what);
    setError(null);
    try {
      const cid = await ipc.profileUploadImage(path);
      if (what === "avatar") setAvatarCid(cid);
      else setBannerCid(cid);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await ipc.profileSave({
        displayName: name(),
        bio: bio(),
        website: website(),
        country: country(),
        avatarCid: avatarCid(),
        bannerCid: bannerCid(),
      });
      store.toast("Profile published");
      await props.onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <Notice title="This is public">
        Your name, bio, avatar, cover, website and country travel the network as a signed event. Anyone can read them and older copies stay on nodes that already have them.
      </Notice>

      <div>
        <div class="mb-1 text-xs text-muted">Cover</div>
        <div class="relative h-28 overflow-hidden rounded-md border border-border bg-surface-2">
          <Show when={banner()}>
            <img src={banner() ?? ""} alt="" class="h-full w-full object-cover" />
          </Show>
          <div class="absolute right-2 top-2 flex gap-2">
            <Button size="sm" variant="secondary" loading={busy() === "banner"} onClick={() => void pick("banner")}>
              <ImagePlus size={13} /> Change
            </Button>
            <Show when={bannerCid()}>
              <Button size="sm" variant="secondary" onClick={() => setBannerCid("")} title="Remove the cover">
                <Trash2 size={13} />
              </Button>
            </Show>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Avatar address={props.profile.address} size={56} src={avatar() ?? null} />
        <Button size="sm" variant="secondary" loading={busy() === "avatar"} onClick={() => void pick("avatar")}>
          <ImagePlus size={13} /> Change photo
        </Button>
        <Show when={avatarCid()}>
          <Button size="sm" variant="secondary" onClick={() => setAvatarCid("")} title="Remove the photo">
            <Trash2 size={13} />
          </Button>
        </Show>
      </div>

      <Field label="Display name" hint="Not your identity: the @username and address beside it are.">
        <Input value={name()} maxLength={128} onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field label="Bio">
        <Textarea rows={3} value={bio()} maxLength={1000} onInput={(e) => setBio(e.currentTarget.value)} />
      </Field>
      <Field label="Website" hint="Starts with https://" error={error() ?? undefined}>
        <Input value={website()} placeholder="https://" onInput={(e) => setWebsite(e.currentTarget.value)} />
      </Field>
      <Field label="Country" hint="Two letters, or empty. Only what you type; never taken from your connection.">
        <Input value={country()} maxLength={2} class="w-24" mono onInput={(e) => setCountry(e.currentTarget.value.toUpperCase())} />
      </Field>

      <div class="flex justify-end gap-2">
        <Button loading={busy() === "save"} onClick={() => void save()}>
          Publish
        </Button>
      </div>
    </div>
  );
}
