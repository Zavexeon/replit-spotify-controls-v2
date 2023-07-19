const AUTH_SERVER_URL = 'https://rs-auth.replit.app'

const DEBUG = {
    BYPASS_PREMIUM_CHECK: false
    , SIMULATE_FREE_USER: false
    , BYPASS_LOCAL_STORAGE: false
    , RESET_LOCAL_STORAGE_ON_LOAD: false
}

if (DEBUG.RESET_LOCAL_STORAGE_ON_LOAD) {
    localStorage.removeItem('spotifyAccessToken')
    localStorage.removeItem('spotifyRefreshToken')
}

let spotify = {
    accessToken:    DEBUG.BYPASS_LOCAL_STORAGE ? null : localStorage.getItem('spotifyAccessToken')
    , refreshToken: DEBUG.BYPASS_LOCAL_STORAGE ? null : localStorage.getItem('spotifyRefreshToken')
}

let getPlayerStatusInterval

const playerElement = document.querySelector('#player')
const showPlayer = () => playerElement.classList.remove('hidden')
const hidePlayer = () => playerElement.classList.add('hidden')

const messageContainerElement = document.querySelector('#message')
const messageContentElement = document.querySelector('#message-content')
const showMessage = message => {
    hidePlayer()
    messageContainerElement.classList.remove('hidden')
    messageContentElement.innerHTML = message
}
const hideMessage = () => messageContainerElement.classList.add('hidden')

const generateState = async () => {
    const currentUser = await replit.data.currentUser()
    return btoa(String(currentUser.user.id + Date.now()))
}

const formatMillesecondsToTimestamp = ms => {
    const date = new Date(ms)
    return `${date.getUTCHours() === 0 ? '' : date.getUTCHours() + ':'}${date.getUTCMinutes()}:${date.getUTCSeconds().toString().padStart(2, '0')}`
}

const refreshAccessToken = async () => {
    console.log('Refreshing access token...')
    const response = await fetch(`${AUTH_SERVER_URL}/get_refresh_token?${new URLSearchParams({ refresh_token: spotify.refreshToken })}`)

    if (response.status === 200) {
        const body = await response.json()
        spotify.accessToken = body.access_token
        if (!DEBUG.BYPASS_LOCAL_STORAGE) localStorage.setItem('spotifyAccessToken', body.access_token)
    } else {
        throw new Error('unable to retrieve new access token')
    }
}

const spotifyAPICall = (method, endpoint, body, callback, iteration=0) => {
    if (iteration >= 100) {
        showMessage('Unable to connect to Spotify API. Please try again later.')
        return window.clearInterval(getPlayerStatusInterval)
    }
    
    const requestTimeout = window.setTimeout(async () => {
        const request = {
            method: method
            , headers: {
                'Content-Type': 'application/json'
                , 'Authorization': `Bearer ${spotify.accessToken}`
            }
        }
        if (body) request.body = body

        const response = await fetch('https://api.spotify.com/v1' + endpoint, request)
        if (response.status === 200 || response.status === 204) {
            if (!callback) return 
            response.json()
                .then(json => callback(json))
                .catch(() => callback())
        } else if (response.status === 401) {
            refreshAccessToken()
                .then(() => {
                    spotifyAPICall(method, endpoint, body, callback, iteration + 1)
                    window.clearTimeout(requestTimeout)
                })
                .catch(error => {
                    showMessage('There was an internal server error. Please refresh or try again later. If the issue persists try clearing your cookies.')
                    window.clearTimeout(requestTimeout)
                    window.clearInterval(getPlayerStatusInterval)
                })
        } else {
            spotifyAPICall(method, endpoint, body, callback, iteration + 1)
            window.clearTimeout(requestTimeout)
        }
 
    }, iteration > 0 ? Math.min((2 ** iteration) + Math.floor(Math.random() * 1000), 10000) : 0)
}

const startControls = () => {
    showMessage('Connecting to Spotify...')

    const progressBarElement = document.querySelector('#progress-bar')
    let userPremium = true
    
    spotifyAPICall('get', '/me', null, user => {
        if (DEBUG.BYPASS_PREMIUM_CHECK) return
        if (user.product !== 'premium' || DEBUG.SIMULATE_FREE_USER) {
            userPremium = false
            document.querySelectorAll('.premium-feature').forEach(element => element.classList.add('hidden'))
            progressBarElement.classList.add('premium-locked')
        }
    })
    
    let cyclesWithoutPlaying = 0
    let lastPlayerStatus
    let isPlaying = false
    let isShuffled = false
    let repeatState = 'off'
    let trackProgressMilleseconds = 0
    let trackLengthMilleseconds = 0
    let progressBarSelected = false
    let volumeSliderSelected = false
    let volumeLevel = 0
    let volumeBeforeMuted = 0
    let trackLink

    const shuffleButtonElement = document.querySelector('#shuffle-button')
    const skipBackButtonElement = document.querySelector('#skip-back-button')
    const playPauseButtonElement = document.querySelector('#play-pause-button')
    const skipForwardButtonElement = document.querySelector('#skip-forward-button')
    const repeatButtonElement = document.querySelector('#repeat-button')
    const volumeSliderElement = document.querySelector('#volume')
    const muteUnmuteButtonElement = document.querySelector('#mute-unmute-button')
    const copyTrackLinkButtonElement = document.querySelector('#copy-track-link-button')
    const elapsedTrackTimeElement = document.querySelector('#elapsed-track-time')
    
    const playPauseIconElement = document.querySelector('#play-pause-button > i')
    const shuffleIconElement = document.querySelector('#shuffle-button > i')
    const repeatIconElement = document.querySelector('#repeat-button > i')
    const volumeIconElement = document.querySelector('#volume-icon')

    const toggleControls = () => {
        const playerStatusSnapshot = lastPlayerStatus
        
        document.querySelectorAll('#player-controls button, #player-controls input').forEach(control => control.disabled = true)

        const enableControlsInterval = window.setInterval(() => {
            if (playerStatusSnapshot === lastPlayerStatus) return
            document.querySelectorAll('#player-controls button, #player-controls input').forEach(control => control.disabled = false)
            window.clearInterval(enableControlsInterval)
        }, 100)
    }

    document.querySelectorAll('#player-controls button, #player-controls input').forEach(control => {
        control.addEventListener('click', () => {
            toggleControls()
        })
    })

    shuffleButtonElement.addEventListener('click', () => spotifyAPICall('put', `/me/player/shuffle?state=${!isShuffled}`))
    
    skipBackButtonElement.addEventListener('click', () =>  {
        trackProgressMilleseconds >= 5000 ?
            spotifyAPICall('put', '/me/player/seek?position_ms=0') :
            spotifyAPICall('post', '/me/player/previous')
    })

    playPauseButtonElement.addEventListener('click', () => {
        isPlaying ? 
            spotifyAPICall('put', '/me/player/pause') :
            spotifyAPICall('put', '/me/player/play')
    })

    skipForwardButtonElement.addEventListener('click', () => spotifyAPICall('post', '/me/player/next'))

    repeatButtonElement.addEventListener('click', () => {
        if (repeatState === 'off') spotifyAPICall('put', '/me/player/repeat?state=context')
        if (repeatState === 'context') spotifyAPICall('put', '/me/player/repeat?state=track')
        if (repeatState === 'track') spotifyAPICall('put', '/me/player/repeat?state=off')
    })

    progressBarElement.addEventListener('input', () => {
        elapsedTrackTimeElement.innerText = formatMillesecondsToTimestamp(Math.floor(trackLengthMilleseconds * (progressBarElement.value / 100)))
    })

    progressBarElement.addEventListener('mousedown', () => progressBarSelected = true)

    progressBarElement.addEventListener('mouseup', () => {
        progressBarSelected = false
        spotifyAPICall('put', `/me/player/seek?position_ms=${Math.floor(trackLengthMilleseconds * (progressBarElement.value / 100))}`)
    })

    volumeSliderElement.addEventListener('mousedown', () => volumeSliderSelected = true)

    volumeSliderElement.addEventListener('mouseup', () => {
        volumeSliderSelected = false
        spotifyAPICall('put', `/me/player/volume?volume_percent=${volumeSliderElement.value}`)
    })

    muteUnmuteButtonElement.addEventListener('click', () => {
        if (volumeSliderElement.value > 0) {
            volumeBeforeMuted = volumeLevel
            spotifyAPICall('put', '/me/player/volume?volume_percent=0')
        } else {
            spotifyAPICall('put', `/me/player/volume?volume_percent=${volumeBeforeMuted}`)
        }
    })

    copyTrackLinkButtonElement.addEventListener('click', () => {
        navigator.clipboard.writeText(trackLink)
        replit.messages.showConfirm('Song link copied to your clipboard!', 5000)
    })

    
    const trackInfoElement = document.querySelector('#track-info')
    const scrollingContainerElement = document.querySelector('#scrolling-container')
    const trackTitleElement = document.querySelector('#track-title')
    const trackAlbumElement = document.querySelector('#album-title') 
    const artistsElement = document.querySelector('#artists')

    const move = () => {
        
    }
    
    const checkIfSongInfoOverflowing = () => {
        if (scrollingContainerElement.scrollWidth > scrollingContainerElement.offsetWidth && window.innerHeight <= 150) { 
            
        } else {
            
        }
    }

    window.addEventListener('resize', () => {
        checkIfSongInfoOverflowing()
    })
    
    getPlayerStatusInterval = window.setInterval(async () => {
        spotifyAPICall('get', '/me/player', null, response => {
            if (!response) {
                if (cyclesWithoutPlaying < 180) {
                    showMessage(`Start playing something on Spotify to get started!<br>We will automatically disconnect you in ${180 - cyclesWithoutPlaying} seconds to save bandwidth.`)
                } else {
                    window.clearInterval(getPlayerStatusInterval)
                    showMessage("You haven't played anything in a while so we automatically disconnected you to save bandwidth! Please refresh the extension if you'd like to continue use.")
                }
                return cyclesWithoutPlaying++
            }

            checkIfSongInfoOverflowing()

            trackProgressMilleseconds = response.progress_ms
            trackLengthMilleseconds = response.item.duration_ms 
            if (!progressBarSelected && !progressBarElement.disabled) {
                progressBarElement.value = trackProgressMilleseconds / trackLengthMilleseconds * 100
                elapsedTrackTimeElement.innerText = formatMillesecondsToTimestamp(response.progress_ms)
            }

            if (!lastPlayerStatus || lastPlayerStatus.item.id !== response.item.id) { 
                const trackCoverImageElement = document.querySelector('#track-cover-image')
                trackCoverImageElement.src = response.item.album.images[0].url

                trackTitleElement.innerText = response.item.name
                trackTitleElement.href = response.item.external_urls.spotify
                trackTitleElement.title = response.item.name

                trackAlbumElement.innerText = response.item.album.name
                trackAlbumElement.href = response.item.album.external_urls.spotify
                trackAlbumElement.title = response.item.album.name

                artistsElement.innerHTML = ''
                response.item.artists.forEach((artist , index) =>  {
                    const artistLinkElement = document.createElement('a')
                    
                    artistLinkElement.innerText = artist.name
                    artistLinkElement.title = artist.name
                    artistLinkElement.href = artist.external_urls.spotify 
                    artistLinkElement.target = "_blank"
                    artistLinkElement.classList.add('artist-link')
    
                    artistsElement.appendChild(artistLinkElement)
    
                    if (index !== response.item.artists.length - 1) {
                        const commaSpan = document.createElement('span')
                        commaSpan.innerText = ', '
                        artistsElement.appendChild(commaSpan)
                    }
                })

                document.querySelector('#spotify-link').href = trackLink
                document.querySelector('#total-track-time').innerText = formatMillesecondsToTimestamp(response.item.duration_ms)
            }

            /* these only update if the user is premium, they're hidden if they're not anyways */
            if (userPremium) {
                isPlaying = response.is_playing
                isShuffled = response.shuffle_state
                repeatState = response.repeat_state
                trackLink = response.item.external_urls.spotify
    
                isShuffled ? 
                    shuffleIconElement.classList.add('icon-active') :
                    shuffleIconElement.classList.remove('icon-active')
    
                if (isPlaying) {
                    playPauseIconElement.classList.remove('ti-player-play-filled')
                    playPauseIconElement.classList.add('ti-player-pause-filled')
                } else {
                    playPauseIconElement.classList.remove('ti-player-pause-filled')
                    playPauseIconElement.classList.add('ti-player-play-filled')
                }
    
                switch (repeatState) {
                    case 'track':
                        repeatIconElement.classList.remove('ti-repeat')
                        repeatIconElement.classList.add('ti-repeat-once', 'icon-active')
                        break
                    case 'context':
                        repeatIconElement.classList.remove('ti-repeat-once')
                        repeatIconElement.classList.add('ti-repeat', 'icon-active')
                        break
                    case 'off':
                        repeatIconElement.classList.remove('ti-repeat-once', 'icon-active')
                        repeatIconElement.classList.add('ti-repeat')
                        break
                }
    
                volumeLevel = response.device.volume_percent
                if (!volumeSliderSelected && !volumeSliderElement.disabled) { 
                    volumeSliderElement.value = volumeLevel
                    volumeSliderElement.title = `Volume: ${volumeLevel}`
                }
                if (response.device.volume_percent > 75) {
                    volumeIconElement.classList.remove('ti-volume-2', 'ti-volume-3')
                    volumeIconElement.classList.add('ti-volume')
                }
                if (response.device.volume_percent <= 75) {
                    volumeIconElement.classList.remove('ti-volume', 'ti-volume-3')
                    volumeIconElement.classList.add('ti-volume-2')
                }
                if (response.device.volume_percent === 0) {
                    volumeIconElement.classList.remove('ti-volume', 'ti-volume-2')
                    volumeIconElement.classList.add('ti-volume-3')
                }
            }
            
            lastPlayerStatus = response
            cyclesWithoutPlaying = 0
            
            hideMessage()
            showPlayer()
        })
    }, 1000)

}

const pollForAuthData = (uuid, state, iteration=0) => {
    const pollTimeout = window.setTimeout(() => {
        fetch(`${AUTH_SERVER_URL}/retrieve_auth_data/${uuid}/${state}`)
            .then(async response => {
                if (response.status !== 200) return pollForAuthData(uuid, state, iteration + 1)
                
                const body = await response.json()

                if (!DEBUG.BYPASS_LOCAL_STORAGE) {
                    localStorage.setItem('spotifyAccessToken', body.access_token)
                    localStorage.setItem('spotifyRefreshToken', body.refresh_token)
                }

                spotify.accessToken = body.access_token
                spotify.refreshToken = body.refresh_token

                window.clearTimeout(pollTimeout)
                startControls()
            })
            .catch(error => {
                showMessage('There was an internal server error. Please refresh or try again later.')
            })
    }, iteration > 100 ? Math.min((2 ** iteration) + Math.floor(Math.random() * 1000), 10000) : 1000)
}

async function main() {
    await replit.init()

    if (window.self === window.top) { 
         // page is open in a browser window, instead of loaded as an extension
        showMessage('This is a Replit extension! Install it using the Extensions Store in a repl!')
    } else {
        if (spotify.accessToken && spotify.refreshToken) {
            startControls()
        } else {
            const state = await generateState()

            fetch(`${AUTH_SERVER_URL}/get_new_id/${state}`)
                .then(async response => {
                    const body = await response.json()
                    
                    showMessage(`Please click <a id="auth-link" target="_blank" href="${AUTH_SERVER_URL}/login?${new URLSearchParams({ uuid: body.uuid })}">here</a> to authenticate with Spotify.`)
                    
                    const authLinkElement = document.querySelector('#auth-link')
                    const authLinkClicked = () => {
                        document.removeEventListener('click', authLinkClicked)
                        showMessage('Waiting for authorization data from server...')
                        pollForAuthData(body.uuid, state)
                    }
                    
                    authLinkElement.addEventListener('click', authLinkClicked)
                })
                .catch(error => {
                    showMessage('Could not connect to authorization server. Please try again later.')
                })
        }
    }
}

window.addEventListener('load', () => {
    main().catch(error => console.log(error))
})