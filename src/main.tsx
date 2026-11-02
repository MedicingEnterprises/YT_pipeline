import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StoreProvider } from './state/store'
import { getMockInitialState } from './state/mockData'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider initialState={getMockInitialState()}>
      <App />
    </StoreProvider>
  </StrictMode>,
)
