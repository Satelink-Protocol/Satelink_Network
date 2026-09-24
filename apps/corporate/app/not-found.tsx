import Link from "next/link";
import { Container } from "@/components/Page";

export default function NotFound() {
  return (
    <Container className="py-32 text-center">
      <p className="text-sm text-amber-ink">404</p>
      <h1 className="mt-3 font-serif text-5xl">Page not found</h1>
      <p className="mt-4 text-stone-4">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="mt-8 inline-block rounded-full bg-ink px-5 py-3 text-sm font-medium text-ivory hover:bg-green">Go home</Link>
    </Container>
  );
}
