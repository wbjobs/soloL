import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ProjectList from './pages/ProjectList';
import AnnotationPage from './pages/AnnotationPage';
import { useAuthStore } from './store/useAuthStore';
import MainLayout from './components/layout/MainLayout';

function App() {
  const { token, isAuthenticated, setToken, setUser } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');
    
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
    setIsChecking(false);
  }, [setToken, setUser]);

  useEffect(() => {
    const handleLogout = () => {
      useAuthStore.getState().logout();
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  if (isChecking) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="spinner w-8 h-8" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/projects" replace /> : <Login />}
        />
        <Route
          path="/projects"
          element={
            isAuthenticated ? (
              <MainLayout>
                <ProjectList />
              </MainLayout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/annotate/:pointCloudId"
          element={
            isAuthenticated ? (
              <AnnotationPage />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/" element={<Navigate to={isAuthenticated ? "/projects" : "/login"} replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/projects" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
