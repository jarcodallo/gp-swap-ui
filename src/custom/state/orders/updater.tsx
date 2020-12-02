import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useActiveWeb3React } from 'hooks'
import { /* useAddPopup ,*/ useBlockNumber } from 'state/application/hooks'
import { AppDispatch, AppState } from 'state'
import { removeOrder } from './actions'
import { utils } from 'ethers'

// first iteration -- checking on each block
// ideally we would check agains backend orders from last session, only once, on page load
// and afterwards continually watch contract events
export function PollOnBlockUpdater(): null {
  const { chainId, library } = useActiveWeb3React()

  const lastBlockNumber = useBlockNumber()

  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector<AppState, AppState['orders']>(state => state.orders)

  // show popup on confirm
  // for displaying fulfilled orders
  // const addPopup = useAddPopup()

  useEffect(() => {
    async function checkOrderStatuses() {
      if (!chainId || !library || !lastBlockNumber) return

      const orders = state[chainId]
      if (!orders) return

      // check for each order by uuid if possible
      // if not, get all orders and filter, will need order.owner
      Object.values(orders).forEach(async order => {
        // order is never undefined here, but TS thinks so
        if (!order) return

        try {
          const { uuid } = order.order
          const res = await fetch(`link_to_service/api/v1/order/${uuid}`)

          if (!res.ok) throw new Error(res.statusText)

          // const orderData: OrderFull = await res.json()

          // if (order not fullfilled) return

          dispatch(removeOrder({ chainId, id: uuid }))
        } catch (error) {
          console.error('Error fetching orders', error)
        }
      })
    }

    checkOrderStatuses()
  }, [chainId, dispatch, lastBlockNumber, library, state])

  return null
}

export function EventUpdater(): null {
  const { chainId, library } = useActiveWeb3React()

  useEffect(() => {
    if (!chainId || !library) return

    const topicSets = [utils.id('Transfer(address,address,uint256)')]

    const listener = (log: any, event: any) => {
      console.log('Transfer::event', event)
      console.log('Transfer::log', log) // the log isn't decoded, better use through contract
      // Emitted any token is sent TO either address
    }
    library.on(topicSets, listener)

    return () => {
      library.off(topicSets, listener)
    }
  }, [chainId, library])

  return null
}