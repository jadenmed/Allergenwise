import { Link } from "react-router-dom";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Cta from "../components/Cta";

export default function NotFound() {
  return (
    <>
      <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 py-20 lg:py-28">
        <div className="w-full max-w-[600px] flex flex-col items-center gap-6 text-center">
          <Badge tone="teal">404 &middot; Page not found</Badge>
          <p className="font-serif font-bold text-[140px] leading-none text-teal-950">
            404
          </p>
          <p className="text-lg text-grey-600">
            We couldn&rsquo;t find what you were looking for
          </p>
          <div className="flex flex-col gap-2">
            <h1 className="font-serif font-semibold text-3xl text-teal-950">
              The Page You Wanted isn&rsquo;t Here
            </h1>
            <p className="text-base text-grey-600 max-w-[480px]">
              The link may be broken, the page may have moved, or you may
              have typed the URL incorrectly. None of these are anything to
              worry about.
            </p>
          </div>
          <Link to="/">
            <Button variant="outline" size="lg">
              Back to home
            </Button>
          </Link>
        </div>
      </section>
      <Cta />
    </>
  );
}
