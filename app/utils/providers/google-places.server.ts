import { invariant } from '@epic-web/invariant'

type LatLng = {
  lat: number
  lng: number
}

type NearbySearchParams = {
  location: LatLng
  radius: number // in meters
}

type PlaceDetailsParams = {
  placeId: string
}

type Restaurant = {
  id: string // Google Place ID
  name: string
  priceLevel: number | null
  rating: number | null
  lat: number
  lng: number
  photoRef: string | null
  mapsUrl: string | null
}

// Google Places API types
type GooglePlacePhoto = {
  photo_reference: string
  height: number
  width: number
  html_attributions: string[]
}

type GooglePlaceResult = {
  place_id: string
  name: string
  price_level?: number
  rating?: number
  geometry: {
    location: {
      lat: number
      lng: number
    }
  }
  photos?: GooglePlacePhoto[]
}

type GooglePlaceDetailsResult = {
  url?: string
}

type GooglePlacesResponse = {
  status: string
  results?: GooglePlaceResult[]
  result?: GooglePlaceDetailsResult
}

/**
 * Fetches nearby restaurants from Google Places API
 */
export async function getNearbyRestaurants({
  lat,
  lng,
  radius = 1600, // Default to 1 mile (1600 meters)
}: {
  lat: number
  lng: number
  radius?: number
}): Promise<Restaurant[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  invariant(apiKey, 'GOOGLE_PLACES_API_KEY must be set')

  // First, get nearby restaurants
  const nearbyResults = await fetchNearbySearch({
    location: { lat, lng },
    radius,
  })

  // Then, get details for each restaurant in parallel
  const detailsPromises = nearbyResults.map(place => 
    fetchPlaceDetails({ placeId: place.place_id })
  )
  
  const detailsResults = await Promise.all(detailsPromises)

  // Combine the data and transform to our schema
  return nearbyResults.map((place, index) => {
    const details = detailsResults[index] || {}
    return {
      id: place.place_id,
      name: place.name,
      priceLevel: place.price_level ?? null,
      rating: place.rating ?? null,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      photoRef: place.photos?.[0]?.photo_reference ?? null,
      mapsUrl: details.url ?? null,
    }
  })
}

async function fetchNearbySearch({ location, radius }: NearbySearchParams): Promise<GooglePlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  invariant(apiKey, 'GOOGLE_PLACES_API_KEY must be set')

  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json')
  url.searchParams.append('location', `${location.lat},${location.lng}`)
  url.searchParams.append('radius', radius.toString())
  url.searchParams.append('type', 'restaurant')
  url.searchParams.append('key', apiKey)

  const response = await fetch(url.toString())
  
  if (!response.ok) {
    throw new Error(`Google Places API error: ${response.statusText}`)
  }

  const data = await response.json() as GooglePlacesResponse
  
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${data.status}`)
  }

  return data.results || []
}

async function fetchPlaceDetails({ placeId }: PlaceDetailsParams): Promise<GooglePlaceDetailsResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  invariant(apiKey, 'GOOGLE_PLACES_API_KEY must be set')

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
  url.searchParams.append('place_id', placeId)
  url.searchParams.append('fields', 'url')
  url.searchParams.append('key', apiKey)

  const response = await fetch(url.toString())
  
  if (!response.ok) {
    throw new Error(`Google Places API error: ${response.statusText}`)
  }

  const data = await response.json() as GooglePlacesResponse
  
  if (data.status !== 'OK') {
    throw new Error(`Google Places API error: ${data.status}`)
  }

  return data.result || {}
} 