import { safeNextPath } from "@/lib/staff/session";
import { SignedIn } from "./signed-in";

type Props = { searchParams: Promise<{ next?: string }> };

// Last stop of sign-in. In the COSHub pop-up it tells the framed page and
// closes; otherwise it carries on to where the user was going.
export default async function DonePage({ searchParams }: Props) {
  const { next } = await searchParams;
  return <SignedIn next={safeNextPath(next)} />;
}
