import { Route, Routes, useLocation } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import ForRestaurants from "./pages/ForRestaurants";
import ForDiners from "./pages/ForDiners";
import FindRestaurant from "./pages/FindRestaurant";
import Resources from "./pages/Resources";
import Course from "./pages/Course";
import CourseLesson from "./pages/CourseLesson";
import Article from "./pages/Article";
import VerifyCertificate from "./pages/VerifyCertificate";

export default function App() {
  const { pathname } = useLocation();
  const isCourseLesson = pathname.startsWith("/course/lesson");

  return (
    <div className="flex flex-col items-center w-full">
      <ScrollToTop />
      {!isCourseLesson && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/for-restaurants" element={<ForRestaurants />} />
        <Route path="/for-diners" element={<ForDiners />} />
        <Route path="/find-restaurant" element={<FindRestaurant />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/course" element={<Course />} />
        <Route path="/course/lesson/:moduleId/:lessonId" element={<CourseLesson />} />
        <Route path="/resources/:slug" element={<Article />} />
        <Route path="/verify/:credentialId" element={<VerifyCertificate />} />
      </Routes>
      {!isCourseLesson && <Footer />}
    </div>
  );
}
