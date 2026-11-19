import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import './design/fun.css'
import { Root } from './Root'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY} />
  </StrictMode>,
)
