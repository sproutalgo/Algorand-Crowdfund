/**
 * seed-projects.js
 * Inserts 65 mock project records into Supabase for pagination testing.
 *
 * Usage (from repo root):
 *   node backend/scripts/seed-projects.js
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 * Remove all seed records afterwards:
 *   node backend/scripts/seed-projects.js --clean
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fake app IDs — high numbers unlikely to collide with real testnet apps.
// All start with 999 to make them easy to identify and clean up.
const SEED_APP_ID_START = 999_000_001
const SEED_COUNT        = 65
const SEED_CREATOR      = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

const CATEGORIES = ['DeFi', 'NFT', 'Gaming', 'Infrastructure', 'DAO', 'Other']

const NAMES = [
  'AlgoVault', 'PixelForge', 'ChainPulse', 'NovaDEX', 'MintLayer',
  'BlockBridge', 'AquaSwap', 'StarDAO', 'EchoNFT', 'GridStack',
  'LunarFi', 'DriftProtocol', 'PulseChain', 'VeraSwap', 'NexusDAO',
  'FluxNFT', 'OrbitFi', 'SkyBridge', 'CoralDEX', 'ZenithDAO',
  'ArcadeChain', 'VaultX', 'NebulaNFT', 'WaveProtocol', 'QuantumFi',
  'IceSwap', 'SolarDAO', 'MetaMint', 'TerraFi', 'CometNFT',
  'AtlasChain', 'PrismDEX', 'CryptoNest', 'AlphaVault', 'BetaSwap',
  'GammaFi', 'DeltaDAO', 'EpsilonNFT', 'ZetaBridge', 'EtaChain',
  'ThetaFi', 'IotaSwap', 'KappaDAO', 'LambdaDEX', 'MuNFT',
  'NuBridge', 'XiFi', 'OmicronChain', 'PiSwap', 'RhoDAO',
  'SigmaFi', 'TauNFT', 'UpsilonBridge', 'PhiDEX', 'ChiChain',
  'PsiFi', 'OmegaDAO', 'AlphaStake', 'BetaMint', 'GammaVault',
  'DeltaBridge', 'EpsilonFi', 'ZetaNFT', 'EtaDAO', 'ThetaSwap',
]

const TAGLINES = [
  'The next-generation DeFi protocol on Algorand.',
  'Mint, trade, and collect unique digital assets.',
  'Cross-chain infrastructure for the Algorand ecosystem.',
  'A decentralized exchange built for speed and security.',
  'Community-governed treasury and voting on-chain.',
  'Low-fee NFT marketplace powered by smart contracts.',
  'Automated yield strategies for Algorand holders.',
  'Permissionless lending and borrowing on Algorand.',
  'Token launchpad for emerging Algorand projects.',
  'Real-time on-chain analytics and portfolio tracking.',
  'Decentralized identity and reputation protocol.',
  'Multi-sig wallet infrastructure for DAOs.',
  'Algorand-native stablecoin and lending market.',
  'Play-to-earn gaming ecosystem on Algorand.',
  'Institutional-grade custody and DeFi access.',
]

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomGoal() {
  const goals = [100, 200, 500, 1000, 2500, 5000]
  return randomItem(goals) * 1_000_000  // microAlgos
}

function randomRate() {
  const rates = [1, 5, 10, 25, 50, 100]
  return randomItem(rates)
}

function randomRaised(goal) {
  const pct = Math.random()
  return Math.floor(goal * pct / 1_000_000) * 1_000_000
}

async function seed() {
  console.log(`Inserting ${SEED_COUNT} seed projects…`)

  const rows = Array.from({ length: SEED_COUNT }, (_, i) => {
    const appId    = SEED_APP_ID_START + i
    const name     = `${NAMES[i % NAMES.length]} ${i + 1}`
    const category = CATEGORIES[i % CATEGORIES.length]
    const goal     = randomGoal()
    const raised   = randomRaised(goal)
    const rate     = randomRate()

    return {
      app_id:          appId,
      creator_address: SEED_CREATOR,
      name:            name.slice(0, 60),
      tagline:         randomItem(TAGLINES),
      description:     `This is a seed/test record for pagination testing. App ID: ${appId}.`,
      category,
      website_url:     '',
      deck_url:        '',
      image_url:       '',
      token_name:      name.replace(/\s+\d+$/, '').slice(0, 8).toUpperCase(),
      goal_micro:      goal,
      rate_per_algo:   rate,
      is_hidden:       false,
      is_funded:       raised >= goal,
      is_distributed:  false,
      is_refunded:     false,
      is_cancelled:    false,
    }
  })

  const { error } = await supabase.from('projects').insert(rows)

  if (error) {
    console.error('Insert failed:', error.message)
    process.exit(1)
  }

  console.log(`✓ Inserted ${SEED_COUNT} seed records (app IDs ${SEED_APP_ID_START}–${SEED_APP_ID_START + SEED_COUNT - 1})`)
  console.log('  Run with --clean to remove them when done.')
}

async function clean() {
  console.log('Removing seed records…')

  const { error, count } = await supabase
    .from('projects')
    .delete({ count: 'exact' })
    .gte('app_id', SEED_APP_ID_START)
    .lte('app_id', SEED_APP_ID_START + SEED_COUNT - 1)

  if (error) {
    console.error('Delete failed:', error.message)
    process.exit(1)
  }

  console.log(`✓ Removed ${count ?? SEED_COUNT} seed records`)
}

const isClean = process.argv.includes('--clean')
if (isClean) {
  clean()
} else {
  seed()
}
