// Drop-in replacements for the `next/*` imports used across the dashboard.
// Lets the copied UI run unedited on pure React + react-router.
import { Suspense, lazy, useMemo } from "react";
import {
  Link as RRLink,
  useLocation,
  useNavigate,
  useParams as useRRParams,
} from "react-router-dom";

/** next/link: <Link href="..."> -> router Link (href mapped to `to`). */
export function Link({ href, ...props }) {
  return <RRLink to={href} {...props} />;
}

/** next/navigation useRouter: push/replace/back/refresh subset. */
export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (to) => navigate(to),
      replace: (to) => navigate(to, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      refresh: () => window.location.reload(),
      prefetch: () => {},
    }),
    [navigate],
  );
}

export { useRRParams as useParams };

/** next/navigation usePathname — falls back to window.location outside the router. */
export function usePathname() {
  let pathname = null;
  try {
    pathname = useLocation().pathname;
  } catch {
    pathname = null;
  }
  if (!pathname && typeof window !== "undefined") pathname = window.location.pathname;
  return pathname;
}

/** next/navigation useSearchParams — returns URLSearchParams like Next does. */
export function useSearchParams() {
  let search = "";
  try {
    search = useLocation().search;
  } catch {
    search = typeof window !== "undefined" ? window.location.search : "";
  }
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Server-side redirect()/notFound() — thrown digests handled by route errorElements. */
export function redirect(url) {
  const e = new Error(`NEXT_REDIRECT ${url}`);
  e.digest = "NEXT_REDIRECT";
  e.url = url;
  throw e;
}

export function notFound() {
  const e = new Error("NEXT_NOT_FOUND");
  e.digest = "NEXT_NOT_FOUND";
  throw e;
}

/** next/image -> plain <img> (Next-only props and children stripped). */
export function Image({ fill, priority, placeholder, blurDataURL, quality, unoptimized, children, ...props }) {
  void fill;
  void priority;
  void placeholder;
  void blurDataURL;
  void quality;
  void unoptimized;
  void children;
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img {...props} />;
}
export default Image;

/** next/dynamic(fn, { ssr: false }) -> React.lazy with an internal Suspense boundary. */
export function dynamic(loader) {
  const Lazy = lazy(loader);
  return function DynamicComponent(props) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
