import CtfArtifact from '@ctf/eth/artifacts/CaptureTheFlag.json'
import ethers from 'ethers'
import {networks} from '../build/gen-networks'
import {RelayProvider, resolveConfigurationGSN} from "@opengsn/gsn";
import {initWeb3Provider} from "./initWeb3Provider";
import pkg from 'eth-sig-util/package.json'
/**
 * a wrapper class for the CTF contract.
 * the only network-specific "leak" from this class is that the "capture()"
 * event returns a transaction object,
 * that the application should wait() until it gets mined.
 */
export class Ctf {

  constructor(addr, signer, gsnProvider, network) {
    this.address = addr
    this.gsnProvider = gsnProvider
    this.network = network
    this.theContract = new ethers.Contract(addr, CtfArtifact.abi, signer)
  }


  async getCurrentFlagHolder() {
    return await this.theContract.currentHolder()
  }

  listenToEvents(onEvent, onProgress) {
    this.theContract.on('FlagCaptured', (previousHolder, currentHolder) => {
      onEvent({previousHolder, currentHolder});
    })
    this.gsnProvider.registerEventListener(onProgress)
  }

  stopListenToEvents(onEvent, onProgress) {
    this.theContract.off(onEvent)
    this.gsnProvider.unregisterEventListener(onProgress)
  }

  async getPastEvents(count = 5) {
    const logs = await this.theContract.queryFilter('FlagCaptured', 1)
    return logs.map(e => ({previousHolder: e.args.previousHolder, currentHolder: e.args.currentHolder})).slice(0, count)
  }

  getSigner() {
    return this.theContract.signer.getAddress()
  }

  async capture() {
    return await this.theContract.captureTheFlag()
  }
}

export async function initCtf() {

  const web3Provider = await initWeb3Provider()

  global.web3Provider = web3Provider

  if (!web3Provider)
    throw new Error( 'No "window.ethereum" found. do you have Metamask installed?')

  const provider = new ethers.providers.Web3Provider(web3Provider);
  const network = await provider.getNetwork()

  let chainId = network.chainId;
  let net = networks.find(net => net.chainId == chainId)
  const netid = await provider.send('net_version')
  console.log('chainid=',chainId, 'networkid=', netid)
  if (chainId !== parseInt(netid))
    console.warn(`Incompatible network-id ${netid} and ${chainId}: for Metamask to work, they should be the same`)
  if (!net) {
    if( chainId<1000 || ! window.location.href.match( /localhos1t|127.0.0.1/ ) )
      throw new Error( 'Unsupported network. please switch to one of: '+ Object.values(networks).map(n=>n.name).join('/'))
    else
      throw new Error( 'To run locally, you must run "yarn evm" and then "yarn deploy" before "yarn react-start" ')
  }

  const gsnConfig = await resolveConfigurationGSN(web3Provider,{
    //log everything (0=debug, 5=error)
    logLevel:0,
    // send all log to central log server, for possible troubleshooting
    loggerUrl: 'https://gsn-logger.netlify.app',
    // loggerApplicationId: 'ctf' // by default, set to application's URL (unless on localhost)
    paymasterAddress: net.paymaster,
    methodSuffix: "_v3",
    jsonStringifyRequest: true
  })
  console.log('===config====', JSON.stringify(gsnConfig, null, 4))
  const gsnProvider = new RelayProvider(web3Provider, gsnConfig)
  const provider2 = new ethers.providers.Web3Provider(gsnProvider);

  const signer = provider2.getSigner()

  let ctf = new Ctf(net.ctf, signer, gsnProvider, net);
  return ctf
}
