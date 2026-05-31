import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Landing } from "@/pages/Landing";
import { MainWorkspace } from "@/pages/MainWorkspace";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/workspace" element={<MainWorkspace />} />
      </Routes>
    </Router>
  );
}
