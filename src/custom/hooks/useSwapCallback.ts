import { useMemo } from 'react'
import { ETHER, Percent, Trade, TradeType } from '@uniswap/sdk'
import { BigNumber } from 'ethers'

import { BIPS_BASE, BUY_ETHER_TOKEN, INITIAL_ALLOWED_SLIPPAGE, RADIX_DECIMAL } from 'constants/index'

import { useAddPendingOrder } from 'state/orders/hooks'

import { SwapCallbackState } from '@src/hooks/useSwapCallback'
import useTransactionDeadline from '@src/hooks/useTransactionDeadline'
import useENS from '@src/hooks/useENS'

import { useActiveWeb3React } from 'hooks'
import { useWrapEther } from 'hooks/useWrapEther'

import { computeSlippageAdjustedAmounts } from 'utils/prices'
import { postOrder } from 'utils/trade'
import { OrderKind } from 'utils/signatures'

const MAX_VALID_TO_EPOCH = BigNumber.from('0xFFFFFFFF').toNumber() // Max uint32 (Feb 07 2106 07:28:15 GMT+0100)

// returns a function that will execute a swap, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the trade
export function useSwapCallback(
  trade: Trade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE, // in bips
  recipientAddressOrName: string | null // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
): { state: SwapCallbackState; callback: null | (() => Promise<string>); error: string | null } {
  const { account, chainId, library } = useActiveWeb3React()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress

  const validTo = useTransactionDeadline()?.toNumber() || MAX_VALID_TO_EPOCH
  const addPendingOrder = useAddPendingOrder()
  const { INPUT: inputAmount, OUTPUT: outputAmount } = computeSlippageAdjustedAmounts(trade, allowedSlippage)
  const wrapEther = useWrapEther()

  return useMemo(() => {
    if (!trade || !library || !account || !chainId || !inputAmount || !outputAmount) {
      return { state: SwapCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }
    if (!recipient) {
      if (recipientAddressOrName !== null) {
        return { state: SwapCallbackState.INVALID, callback: null, error: 'Invalid recipient' }
      } else {
        return { state: SwapCallbackState.LOADING, callback: null, error: null }
      }
    }

    const isBuyEth = trade.outputAmount.currency === ETHER
    const isSellEth = trade.inputAmount.currency === ETHER

    if (isSellEth && !wrapEther) {
      return { state: SwapCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }

    return {
      state: SwapCallbackState.VALID,
      callback: async function onSwap(): Promise<string> {
        const {
          executionPrice,
          inputAmount: expectedInputAmount,
          nextMidPrice,
          outputAmount: expectedOutputAmount,
          priceImpact,
          route,
          tradeType
        } = trade
        const path = route.path
        const sellToken = path[0]
        const buyToken = isBuyEth ? BUY_ETHER_TOKEN[chainId] : path[path.length - 1]

        const slippagePercent = new Percent(allowedSlippage.toString(RADIX_DECIMAL), BIPS_BASE)
        const routeDescription = route.path.map(token => token.symbol || token.name || token.address).join(' → ')
        const kind = trade.tradeType === TradeType.EXACT_INPUT ? OrderKind.SELL : OrderKind.BUY

        console.log(
          `[useSwapCallback] Trading ${routeDescription}. Input = ${inputAmount.toExact()}, Output = ${outputAmount.toExact()}, Price = ${executionPrice.toFixed()}, Details: `,
          {
            expectedInputAmount: expectedInputAmount.toExact(),
            expectedOutputAmount: expectedOutputAmount.toExact(),
            inputAmountEstimated: inputAmount.toExact(),
            outputAmountEstimated: outputAmount.toExact(),
            executionPrice: executionPrice.toFixed(),
            sellToken,
            buyToken,
            validTo,
            isSellEth,
            isBuyEth,
            nextMidPrice: nextMidPrice.toFixed(),
            priceImpact: priceImpact.toSignificant(),
            tradeType: tradeType.toString(),
            allowedSlippage,
            slippagePercent: slippagePercent.toFixed() + '%',
            recipient,
            recipientAddressOrName,
            chainId
          }
        )

        const wrapPromise = isSellEth && wrapEther ? wrapEther(inputAmount) : undefined

        // TODO: indicate somehow in the order when the user was to receive ETH === isBuyEth flag
        const postOrderPromise = postOrder({
          kind,
          account,
          chainId,
          inputAmount,
          outputAmount,
          sellToken,
          buyToken,
          validTo,
          recipient,
          recipientAddressOrName,
          addPendingOrder,
          signer: library.getSigner()
        })

        if (wrapPromise) {
          const wrapTx = await wrapPromise
          console.log('[useSwapCallback] Wrapped ETH successfully. Tx: ', wrapTx)
        }

        return postOrderPromise
      },
      error: null
    }
  }, [
    trade,
    library,
    account,
    chainId,
    inputAmount,
    outputAmount,
    recipient,
    recipientAddressOrName,
    allowedSlippage,
    validTo,
    wrapEther,
    addPendingOrder
  ])
}
