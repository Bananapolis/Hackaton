import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { StartupPresentationSite, isStartupPresentationPath } from './StartupPresentationSite'
import './styles.css'

function RootApp() {
  const [pathname, setPathname] = React.useState(() => window.location.pathname)

  React.useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', syncPathname)
    return () => window.removeEventListener('popstate', syncPathname)
  }, [])

  if (isStartupPresentationPath(pathname)) {
    return <StartupPresentationSite pathname={pathname} />
  }

  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)
