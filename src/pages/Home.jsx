import Hero from "../components/Hero";
import CredibilityStrip from "../components/CredibilityStrip";
import StatsBar from "../components/StatsBar";
import HowItWorks from "../components/HowItWorks";
import Audiences from "../components/Audiences";
import Benefits from "../components/Benefits";
import Cta from "../components/Cta";
import Faq from "../components/Faq";
import Blogs from "../components/Blogs";

export default function Home() {
  return (
    <>
      <Hero />
      <CredibilityStrip />
      <StatsBar />
      <HowItWorks />
      <Audiences />
      <Benefits />
      <Cta />
      <Faq />
      <Blogs />
    </>
  );
}
