import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import MarketingLanding from './MarketingLanding.jsx'
import LearnPage from './LearnPage.jsx'
import { pickTopLevelPage } from './onboarding.js'

// The app (and its Supabase client) only loads for /app, deep links and
// signed-in users, so the marketing landing stays light.
const App = lazy(() => import('./App.jsx'))
const NewVersionBanner = lazy(() => import('./NewVersionBanner.jsx'))

let page = 'app'
try { page = pickTopLevelPage(window.location, window.localStorage) } catch { page = 'app' }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {page === 'landing' ? <MarketingLanding /> : page === 'learn' ? <LearnPage /> : (
      <Suspense fallback={null}><App /><NewVersionBanner /></Suspense>
    )}
  </React.StrictMode>,
)
