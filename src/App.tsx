import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './components/WelcomeScreen'
import RegisterScreen from './components/RegisterScreen'
import VerificationScreen from './components/VerificationScreen'
import MapScreen from './components/MapScreen'
import AuthCheck from './components/AuthCheck'
import './App.css'

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
    </BrowserRouter>
  )
}

export default App
