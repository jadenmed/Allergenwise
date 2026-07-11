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
import ExamPreview from "./pages/ExamPreview";
import ExamSession from "./pages/ExamSession";
import ExamResults from "./pages/ExamResults";
import ExamResultsPending from "./pages/ExamResultsPending";
import ExamResultsFailed from "./pages/ExamResultsFailed";
import Dashboard from "./pages/Dashboard";
import Article from "./pages/Article";
import VerifyCertificate from "./pages/VerifyCertificate";

export default function App() {
  const { pathname } = useLocation();
  const isCourseLesson = pathname.startsWith("/course/lesson");
  const isExam = pathname.startsWith("/course/exam");
  const isExamResults = pathname.startsWith("/course/exam/results");
  const isDashboard = pathname.startsWith("/dashboard");
  const hideNavbar = isCourseLesson || isExam || isDashboard;
  const hideFooter = isCourseLesson || isDashboard || (isExam && !isExamResults);

  return (
    <div className="flex flex-col items-center w-full">
      <ScrollToTop />
      {!hideNavbar && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/for-restaurants" element={<ForRestaurants />} />
        <Route path="/for-diners" element={<ForDiners />} />
        <Route path="/find-restaurant" element={<FindRestaurant />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/course" element={<Course />} />
        <Route path="/course/lesson/:moduleId/:lessonId" element={<CourseLesson />} />
        <Route path="/course/exam/preview" element={<ExamPreview />} />
        <Route path="/course/exam/results" element={<ExamResults />} />
        <Route
          path="/course/exam/results/pending"
          element={<ExamResultsPending />}
        />
        <Route
          path="/course/exam/results/failed"
          element={<ExamResultsFailed />}
        />
        <Route path="/course/exam" element={<ExamSession />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/resources/:slug" element={<Article />} />
        <Route path="/verify/:credentialId" element={<VerifyCertificate />} />
      </Routes>
      {!hideFooter && <Footer />}
    </div>
  );
}
