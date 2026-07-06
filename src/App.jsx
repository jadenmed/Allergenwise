import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import CredibilityStrip from "./components/CredibilityStrip";
import StatsBar from "./components/StatsBar";
import HowItWorks from "./components/HowItWorks";
import Audiences from "./components/Audiences";
import Benefits from "./components/Benefits";
import Cta from "./components/Cta";
import Faq from "./components/Faq";
import Blogs from "./components/Blogs";
import Footer from "./components/Footer";

export default function App() {
  return (
    <div className="flex flex-col items-center w-full">
      <Navbar />
      <Hero />
      <CredibilityStrip />
      <StatsBar />
      <HowItWorks />
      <Audiences />
      <Benefits />
      <Cta />
      <Faq />
      <Blogs />
      <Footer />
    </div>
  );
}
