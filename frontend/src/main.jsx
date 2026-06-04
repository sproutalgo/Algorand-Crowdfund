import React from 'react'
import ReactDOM from 'react-dom/client'
import { WalletProvider, WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet-react'
import App from './App'
import './index.css'

const walletManager = new WalletManager({
  wallets: [
    {
      id: WalletId.PERA,
      options: { projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID },
    },
    {
      id: WalletId.DEFLY,
      options: { projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID },
    },
  ],
  network: NetworkId.TESTNET,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>
)
