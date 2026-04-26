import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './components/WelcomeScreen'
import AuthCheck from './components/AuthCheck'
import './App.css'

// LAZY LOADING для тяжёлых компонентов
const RegisterScreen = lazy(() => import('./components/RegisterScreen'))
const VerificationScreen = lazy(() => import('./components/VerificationScreen'))
const MapScreen = lazy(() => import('./components/MapScreen'))

// Loader
const Loader = () => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    height: '100vh',
    background: '#fff'
  }}>
    <div style={{
      width: '40px',
      height: '40px',
      border: '4px solid rgba(21, 180, 0, 0.2)',
      borderTopColor: '#15B400',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }}></div>
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
)

// Заглушка для экранов
const PlaceholderScreen = ({ title }: { title: string }) => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    height: '100vh', 
    background: '#4285F4',
    color: 'white',
    fontSize: '24px',
    fontFamily: 'Montserrat, sans-serif'
  }}>
    {title}
  </div>
)

function App() {
  return (
    <BrowserRouter>
      <AuthCheck />
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/login" element={<div>Login Screen (скоро)</div>} />
          <Route path="/register" element={<RegisterScreen />} />
          <Route path="/verification" element={<VerificationScreen />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/profile" element={<MapScreen />} />
          
          {/* Заглушки для футера */}
          <Route path="/search" element={<PlaceholderScreen title="🔍 Поиск" />} />
          <Route path="/orders" element={<PlaceholderScreen title="📋 Заказы" />} />
          <Route path="/finance" element={<PlaceholderScreen title="💰 Финансы" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
