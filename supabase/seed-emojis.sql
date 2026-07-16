-- ============================================================================
-- Seed the custom-emoji picker with the classic Twitter/Twemoji set (the clean,
-- colorful style Discord uses by default — not Apple's).
--
-- Images are served from the free jsDelivr CDN, so nothing is uploaded to your
-- Supabase storage. Paste this whole file into the Supabase SQL editor and Run.
-- Safe to re-run: it skips any name you've already added.
--
-- Type :name: in chat to use one (e.g. :joy:), or click it in the 😊 picker.
-- ============================================================================

insert into public.emojis (name, image_url) values
  -- faces
  ('grinning',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f600.svg'),
  ('smile',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f604.svg'),
  ('grin',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f601.svg'),
  ('laughing',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f606.svg'),
  ('joy',         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f602.svg'),
  ('rofl',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f923.svg'),
  ('blush',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60a.svg'),
  ('slight_smile','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f642.svg'),
  ('upside_down', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f643.svg'),
  ('wink',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f609.svg'),
  ('heart_eyes',  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60d.svg'),
  ('smiling_hearts','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f970.svg'),
  ('kissing_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f618.svg'),
  ('yum',         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60b.svg'),
  ('tongue',      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f61b.svg'),
  ('sunglasses',  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60e.svg'),
  ('star_struck', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f929.svg'),
  ('thinking',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f914.svg'),
  ('smirk',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60f.svg'),
  ('relieved',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f60c.svg'),
  ('pensive',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f614.svg'),
  ('sweat_smile', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f605.svg'),
  ('cry',         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f622.svg'),
  ('sob',         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f62d.svg'),
  ('pleading',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f97a.svg'),
  ('flushed',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f633.svg'),
  ('scream',      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f631.svg'),
  ('rage',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f621.svg'),
  ('triumph',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f624.svg'),
  ('grimacing',   'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f62c.svg'),
  ('partying',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f973.svg'),
  ('skull',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f480.svg'),
  ('ghost',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f47b.svg'),
  ('clown',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f921.svg'),
  -- hands
  ('thumbsup',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f44d.svg'),
  ('thumbsdown',  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f44e.svg'),
  ('clap',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f44f.svg'),
  ('pray',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f64f.svg'),
  ('muscle',      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f4aa.svg'),
  ('wave',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f44b.svg'),
  ('ok_hand',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f44c.svg'),
  ('raised_hands','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f64c.svg'),
  ('eyes',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f440.svg'),
  -- hearts & symbols
  ('heart',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2764.svg'),
  ('orange_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f9e1.svg'),
  ('yellow_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f49b.svg'),
  ('green_heart', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f49a.svg'),
  ('blue_heart',  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f499.svg'),
  ('purple_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f49c.svg'),
  ('black_heart', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f5a4.svg'),
  ('white_heart', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f90d.svg'),
  ('sparkling_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f496.svg'),
  ('two_hearts',  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f495.svg'),
  ('broken_heart','https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f494.svg'),
  ('fire',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f525.svg'),
  ('star',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2b50.svg'),
  ('sparkles',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2728.svg'),
  ('tada',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f389.svg'),
  ('confetti',    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f38a.svg'),
  ('hundred',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f4af.svg'),
  ('sweat_drops', 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f4a6.svg'),
  ('zzz',         'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f4a4.svg'),
  ('cloud',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2601.svg'),
  ('rainbow',     'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f308.svg'),
  ('crown',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f451.svg'),
  ('gift',        'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f381.svg'),
  ('check',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/2705.svg'),
  ('cross',       'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/274c.svg')
on conflict (name) do nothing;
