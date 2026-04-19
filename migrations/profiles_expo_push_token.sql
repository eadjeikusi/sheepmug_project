-- Store Expo push token for mobile push notifications.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS expo_push_token text;
