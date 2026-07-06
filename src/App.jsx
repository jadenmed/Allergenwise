import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import ForRestaurants from "./pages/ForRestaurants";
import ForDiners from "./pages/ForDiners";
import FindRestaurant from "./pages/FindRestaurant";
import Resources from "./pages/Resources";

export default function App() {
  return (
    <div className="flex flex-col items-center w-full">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/for-restaurants" element={<ForRestaurants />} />
        <Route path="/for-diners" element={<ForDiners />} />
        <Route path="/find-restaurant" element={<FindRestaurant />} />
        <Route path="/resources" element={<Resources />} />
      </Routes>
      <Footer />
    </div>
  );
}
