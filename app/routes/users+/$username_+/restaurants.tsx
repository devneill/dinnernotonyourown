import { invariant } from '@epic-web/invariant'
import { useLoaderData, useSearchParams, Link, Form, useNavigation, useFetcher, type ActionFunctionArgs, type LoaderFunctionArgs  } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server'
import { getAllRestaurantDetails, joinDinnerGroup, leaveDinnerGroup, type RestaurantWithDetails } from '#app/utils/restaurants.server'
import { cn } from '#app/utils/misc.tsx'
import { StatusButton } from '#app/components/ui/status-button'
import { Card, CardContent, CardFooter, CardHeader } from '#app/components/ui/card'
import { Badge } from '#app/components/ui/badge'
import { Toggle } from '#app/components/ui/toggle'
import { MapPin, Map, Star } from 'lucide-react'

// Constants
const HILTON_COORDINATES = {
  lat: 40.7596,
  lng: -111.8867,
}

// Schemas
const JoinDinnerSchema = z.object({
  intent: z.literal('join'),
  restaurantId: z.string(),
})

const LeaveDinnerSchema = z.object({
  intent: z.literal('leave'),
})

const ActionSchema = z.discriminatedUnion('intent', [
  JoinDinnerSchema,
  LeaveDinnerSchema,
])

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  const url = new URL(request.url)
  
  // Get filter parameters from URL
  const distanceFilter = url.searchParams.get('distance') ? 
    parseInt(url.searchParams.get('distance') as string) : undefined
  const ratingFilter = url.searchParams.get('rating') ? 
    parseInt(url.searchParams.get('rating') as string) : undefined
  const priceFilter = url.searchParams.get('price') ? 
    parseInt(url.searchParams.get('price') as string) : undefined
  
  // Convert distance from miles to meters for the API
  const radiusInMeters = distanceFilter ? distanceFilter * 1609 : undefined // 1 mile = 1609 meters
  
  // Get all restaurants with details
  const allRestaurants = await getAllRestaurantDetails({
    userId,
    userLat: HILTON_COORDINATES.lat,
    userLng: HILTON_COORDINATES.lng,
    radius: radiusInMeters,
  })
  
  // Split into two lists
  const restaurantsWithAttendance = allRestaurants
    .filter(restaurant => restaurant.attendeeCount > 0)
    .sort((a, b) => b.attendeeCount - a.attendeeCount)
  
  // Apply filters to restaurants without attendees
  let restaurantsNearby = allRestaurants
    .filter(restaurant => restaurant.attendeeCount === 0)
  
  // Apply distance filter
  if (distanceFilter) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => restaurant.distance <= distanceFilter
    )
  }
  
  // Apply rating filter
  if (ratingFilter) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => (restaurant.rating ?? 0) >= ratingFilter
    )
  }
  
  // Apply price filter
  if (priceFilter) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => restaurant.priceLevel === priceFilter
    )
  }
  
  // Sort by rating (desc) and distance (asc) as tiebreaker
  restaurantsNearby = restaurantsNearby
    .sort((a, b) => {
      // First by rating (descending)
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0)
      if (ratingDiff !== 0) return ratingDiff
      
      // Then by distance (ascending)
      return a.distance - b.distance
    })
    .slice(0, 15) // Limit to top 15
  
  return {
    restaurantsWithAttendance,
    restaurantsNearby,
    filters: {
      distance: distanceFilter,
      rating: ratingFilter,
      price: priceFilter,
    },
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  const result = ActionSchema.safeParse(Object.fromEntries(formData))
  
  if (!result.success) {
    return { status: 'error', errors: result.error.flatten() }
  }
  
  const { intent } = result.data
  
  if (intent === 'join') {
    const { restaurantId } = result.data
    await joinDinnerGroup({ userId, restaurantId })
  } else if (intent === 'leave') {
    await leaveDinnerGroup({ userId })
  }
  
  return { status: 'success' }
}

export default function RestaurantsRoute() {
  const { restaurantsWithAttendance, restaurantsNearby, filters } = useLoaderData<typeof loader>()
  
  return (
    <div className="container py-8 space-y-8">
      <h1 className="text-3xl font-bold">Restaurants</h1>
      
      <DinnerPlansSection restaurants={restaurantsWithAttendance} />
      
      <RestaurantListSection 
        restaurants={restaurantsNearby} 
        currentFilters={filters} 
      />
    </div>
  )
}

function DinnerPlansSection({ restaurants }: { restaurants: RestaurantWithDetails[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold">Dinner Plans</h2>
      
      {restaurants.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {restaurants.map(restaurant => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      ) : (
        <div className="h-[220px] border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
          Everyone is having dinner on their own 🥲
        </div>
      )}
    </section>
  )
}

function RestaurantListSection({ 
  restaurants, 
  currentFilters 
}: { 
  restaurants: RestaurantWithDetails[]
  currentFilters: {
    distance?: number
    rating?: number
    price?: number
  }
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold">Nearby Restaurants</h2>
      
      <Filters currentFilters={currentFilters} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {restaurants.map(restaurant => (
          <RestaurantCard key={restaurant.id} restaurant={restaurant} />
        ))}
        
        {restaurants.length === 0 && (
          <div className="col-span-full h-[220px] border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
            No restaurants match your filters
          </div>
        )}
      </div>
    </section>
  )
}

function Filters({ 
  currentFilters 
}: { 
  currentFilters: {
    distance?: number
    rating?: number
    price?: number
  }
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  
  const updateFilter = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams)
    
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    
    setSearchParams(newParams, { 
      preventScrollReset: true, 
      replace: true 
    })
  }
  
  return (
    <div className="space-y-2">
      {/* Distance Filter */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium w-16 pt-2">Distance:</span>
        <div className="grid grid-cols-4 gap-2 flex-1">
          {[1, 2, 5, 10].map(distance => (
            <Toggle
              key={distance}
              pressed={currentFilters.distance === distance}
              onPressedChange={(pressed) => 
                updateFilter('distance', pressed ? distance.toString() : null)
              }
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {distance}mi
            </Toggle>
          ))}
        </div>
      </div>
      
      {/* Rating Filter */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium w-16 pt-2">Rating:</span>
        <div className="grid grid-cols-4 gap-2 flex-1">
          {[1, 2, 3, 4].map(rating => (
            <Toggle
              key={rating}
              pressed={currentFilters.rating === rating}
              onPressedChange={(pressed) => 
                updateFilter('rating', pressed ? rating.toString() : null)
              }
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {'⭐'.repeat(rating)}
            </Toggle>
          ))}
        </div>
      </div>
      
      {/* Price Filter */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium w-16 pt-2">Price:</span>
        <div className="grid grid-cols-4 gap-2 flex-1">
          {[1, 2, 3, 4].map(price => (
            <Toggle
              key={price}
              pressed={currentFilters.price === price}
              onPressedChange={(pressed) => 
                updateFilter('price', pressed ? price.toString() : null)
              }
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {'$'.repeat(price)}
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  )
}

function RestaurantCard({ restaurant }: { restaurant: RestaurantWithDetails }) {
  const fetcher = useFetcher()
  const isJoining = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'join'
  const isLeaving = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'leave'
  
  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 bg-muted">
        {restaurant.photoRef ? (
          <img 
            src={`/resources/maps/photo?photoRef=${restaurant.photoRef}`}
            alt={restaurant.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <span className="text-muted-foreground">No image available</span>
          </div>
        )}
        
        <div className="absolute top-2 right-2 flex gap-2">
          {restaurant.rating ? (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {restaurant.rating.toFixed(1)}
            </Badge>
          ) : null}
          
          {restaurant.priceLevel ? (
            <Badge variant="secondary">
              {'$'.repeat(restaurant.priceLevel)}
            </Badge>
          ) : null}
        </div>
      </div>
      
      <CardHeader className="pb-2">
        <h3 className="font-bold truncate">{restaurant.name}</h3>
      </CardHeader>
      
      <CardContent className="pb-2 space-y-1">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{restaurant.distance} mi</span>
        </div>
        
        {restaurant.mapsUrl && (
          <div>
            <Link 
              to={restaurant.mapsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Map className="h-4 w-4" />
              <span>Directions</span>
            </Link>
          </div>
        )}
        
        <div className="text-sm">
          {restaurant.attendeeCount > 0 ? (
            <span className="font-medium">{restaurant.attendeeCount} attending</span>
          ) : (
            <span className="text-muted-foreground">No attendees yet</span>
          )}
        </div>
      </CardContent>
      
      <CardFooter>
        <fetcher.Form method="post" className="w-full">
          {restaurant.isUserAttending ? (
            <>
              <input type="hidden" name="intent" value="leave" />
              <StatusButton
                type="submit"
                variant="destructive"
                status={isLeaving ? 'pending' : 'idle'}
                disabled={isLeaving}
                className="w-full"
              >
                {isLeaving ? 'Leaving...' : 'Leave'}
              </StatusButton>
            </>
          ) : (
            <>
              <input type="hidden" name="intent" value="join" />
              <input type="hidden" name="restaurantId" value={restaurant.id} />
              <StatusButton
                type="submit"
                variant="default"
                status={isJoining ? 'pending' : 'idle'}
                disabled={isJoining}
                className="w-full"
              >
                {isJoining ? 'Joining...' : 'Join'}
              </StatusButton>
            </>
          )}
        </fetcher.Form>
      </CardFooter>
    </Card>
  )
} 