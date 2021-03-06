import { updateInstanceInfo, updateVerifyCredentialsForInstance } from '../../_actions/instances'
import { setupListsForInstance } from '../../_actions/lists'
import { createStream } from '../../_actions/stream/streaming'
import { updatePushSubscriptionForInstance } from '../../_actions/pushSubscription'
import { setupCustomEmojiForInstance } from '../../_actions/emoji'
import { scheduleIdleTask } from '../../_utils/scheduleIdleTask'
import { mark, stop } from '../../_utils/marks'
import { store } from '../store'
import { updateFollowRequestCountIfLockedAccount } from '../../_actions/followRequests'

// stream to watch for home timeline updates and notifications
let currentInstanceStream

async function refreshInstanceDataAndStream (store, instanceName) {
  mark(`refreshInstanceDataAndStream-${instanceName}`)
  await doRefreshInstanceDataAndStream(store, instanceName)
  stop(`refreshInstanceDataAndStream-${instanceName}`)
}

function currentInstanceChanged (store, instanceName) {
  return store.get().currentInstance !== instanceName
}

async function doRefreshInstanceDataAndStream (store, instanceName) {
  if (currentInstanceChanged(store, instanceName)) {
    return
  }

  await refreshInstanceData(instanceName)

  if (currentInstanceChanged(store, instanceName)) {
    return
  }

  const { currentInstanceInfo } = store.get()
  if (!currentInstanceInfo) {
    return
  }

  stream(store, instanceName, currentInstanceInfo)
}

async function refreshInstanceData (instanceName) {
  // these are all low-priority
  scheduleIdleTask(() => setupCustomEmojiForInstance(instanceName))
  scheduleIdleTask(() => setupListsForInstance(instanceName))
  scheduleIdleTask(() => updatePushSubscriptionForInstance(instanceName))

  // these are the only critical ones
  await Promise.all([
    updateInstanceInfo(instanceName),
    updateVerifyCredentialsForInstance(instanceName).then(() => {
      // Once we have the verifyCredentials (so we know if the account is locked), lazily update the follow requests
      scheduleIdleTask(() => updateFollowRequestCountIfLockedAccount(instanceName))
    })
  ])
}

function stream (store, instanceName, currentInstanceInfo) {
  const { accessToken } = store.get()
  const streamingApi = currentInstanceInfo.urls.streaming_api
  const firstStatusId = store.getFirstTimelineItemId(instanceName, 'home')
  const firstNotificationId = store.getFirstTimelineItemId(instanceName, 'notifications')

  currentInstanceStream = createStream(streamingApi, instanceName, accessToken, 'home',
    firstStatusId, firstNotificationId)

  if (process.env.NODE_ENV !== 'production') {
    window.currentInstanceStream = currentInstanceStream
  }
}

export function instanceObservers () {
  store.observe('currentInstance', async (currentInstance) => {
    if (!process.browser) {
      return
    }
    if (currentInstanceStream) {
      currentInstanceStream.close()
      currentInstanceStream = null
      if (process.env.NODE_ENV !== 'production') {
        window.currentInstanceStream = null
      }
    }
    if (!currentInstance) {
      return
    }

    scheduleIdleTask(() => refreshInstanceDataAndStream(store, currentInstance))
  })
}
