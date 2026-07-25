import { lazy, Suspense, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomeScreen from './screens/Welcome/WelcomeScreen'
import AuthCheck from './screens/Auth/AuthCheck'
import JobDetailsScreenEager from './screens/Map/JobDetailsScreen'
import WaiterCallOverlay from './screens/shared/WaiterCallOverlay'
import AppBadgeSync from './screens/shared/AppBadgeSync'
import PushPermissionPrompt from './screens/shared/PushPermissionPrompt'
import './App.css'

const RegisterScreen = lazy(() => import('./screens/Auth/RegisterScreen'))
const VerificationScreen = lazy(() => import('./screens/Auth/VerificationScreen'))
const RegistrationForm = lazy(() => import('./screens/Auth/RegistrationForm'))
const MapScreen = lazy(() => import('./screens/Map/MapScreen'))
const JobDetailsScreen = lazy(() => import('./screens/Map/JobDetailsScreen'))
const BookingSuccessScreen = lazy(() => import('./screens/Booking/BookingSuccessScreen'))
const MyShiftsScreen = lazy(() => import('./screens/MyShifts/MyShiftsScreen'))
const QRScannerScreen = lazy(() => import('./screens/Restaurant/QRScanner/QRScannerScreen'))
const TablesScreen = lazy(() => import('./screens/Restaurant/Tables/TablesScreen'))
const GuestDescriptionScreen = lazy(() => import('./screens/Restaurant/TableSession/GuestDescriptionScreen'))
const MenuScreen = lazy(() => import('./screens/Restaurant/Menu/MenuScreen'))
const OrderScreen = lazy(() => import('./screens/Restaurant/Order/OrderScreen'))
const AllOrdersScreen = lazy(() => import('./screens/Restaurant/Order/AllOrdersScreen'))
const GuestCartsScreen = lazy(() => import('./screens/Restaurant/Order/GuestCartsScreen'))
const IncomeScreen = lazy(() => import('./screens/Income/IncomeScreen'))

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

  const handleJobClick = useCallback((restaurantId: string, shiftDate: string) => {
    setJobDetails({ restaurantId, shiftDate })
  }, [])

  return (
    <>
      <div style={{ display: jobDetails ? 'none' : 'block' }}>
        <MapScreen onJobClick={handleJobClick} />
      </div>

      {jobDetails && (
        <JobDetailsScreenEager
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
      <WaiterCallOverlay />
      <AppBadgeSync />
      <PushPermissionPrompt />
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
          <Route path="/my-shifts" element={<MyShiftsScreen />} />
          <Route path="/restaurant/scan" element={<QRScannerScreen />} />
          <Route path="/restaurant/tables" element={<TablesScreen />} />
          <Route path="/restaurant/table/:tableId/guests" element={<GuestDescriptionScreen />} />
          <Route path="/restaurant/menu" element={<MenuScreen />} />
          <Route path="/restaurant/table/:tableId/order" element={<OrderScreen />} />
          <Route path="/restaurant/table/:tableId/all-orders" element={<AllOrdersScreen />} />
          <Route path="/restaurant/table/:tableId/guest-carts" element={<GuestCartsScreen />} />

          <Route path="/search" element={<PlaceholderScreen title="🔍 Поиск" />} />
          <Route path="/orders" element={<PlaceholderScreen title="📋 Заказы" />} />
          <Route path="/finance" element={<IncomeScreen />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
