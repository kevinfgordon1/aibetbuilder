import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import NewVersionBanner from './NewVersionBanner.jsx'
import MarketingLanding from './MarketingLanding.jsx'
import LearnPage from './LearnPage.jsx'
import { pickTopLevelPage } from './onboarding.js'

let page = 'app'
try { page = pickTopLevelPage(window.location, window.localStorage) } catch { page = 'app' }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {page === 'landing' ? <MarketingLanding /> : page === 'learn' ? <LearnPage /> : (<><App /><NewVersionBanner /></>)}
  </React.StrictMode>,
)
