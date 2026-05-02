import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './components/WelcomeScreen'
import AuthCheck from './components/AuthCheck'
import JobDetailsScreen from './components/JobDetailsScreen'
import './App.css'
import RegistrationForm from './components/RegistrationForm'
import BookingSuccessScreen from './components/BookingSuccessScreen'

const RegisterScreen = lazy(() => import('./components/RegisterScreen'))
const VerificationScreen = lazy(() => import('./components/VerificationScreen'))
const MapScreen = lazy(() => import('./components/MapScreen'))

const Loader = () => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    height: '100vh',
    background: '#102A45'
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

// НОВОЕ: Обёртка для MapScreen с логикой "Hide, don't Unmount"
function MapScreenWithDetails() {
  const [jobDetails, setJobDetails] = useState<{
    restaurantId: string
    shiftDate: string
  } | null>(null)

  return (
    <>
      <div style={{ display: jobDetails ? 'none' : 'block' }}>
        <MapScreen onJobClick={(restaurantId, shiftDate) => {
          setJobDetails({ restaurantId, shiftDate })
        }} />
      </div>

      {jobDetails && (
        <JobDetailsScreen
          restaurantId={jobDetails.restaurantId}
          shiftDate={jobDetails.shiftDate}
          onClose={() => setJobDetails(null)}
        />
      )}
    </>
  )
}

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
          <Route path="/registration" element={<RegistrationForm />} />
          {/* ИЗМЕНЕНО: Используем обёртку */}
          <Route path="/map" element={<MapScreenWithDetails />} />
          <Route path="/profile" element={<MapScreenWithDetails />} />
          <Route path="/booking-success" element={<BookingSuccessScreen />} />
          
          <Route path="/search" element={<PlaceholderScreen title="🔍 Поиск" />} />
          <Route path="/orders" element={<PlaceholderScreen title="📋 Заказы" />} />
          <Route path="/finance" element={<PlaceholderScreen title="💰 Финансы" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
