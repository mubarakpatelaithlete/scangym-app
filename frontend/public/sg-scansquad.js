/**
 * sg-scansquad.js — lazy chunk, split out of app.ctr576.js.
 *
 * Loaded by sgChunk('sg-scansquad') when a route in this area is rendered, and
 * prefetched at idle after first paint. Declares exactly the globals it
 * declared inside the monolith, so every existing inline onclick keeps
 * working unchanged.
 *
 * Generated once by tools/split-bundle.js. Edit these functions HERE — the
 * copies in app.ctr576.js are gone, not commented out.
 *
 * Pages (returned to _renderInner, gated on this chunk being loaded):
 *   CreatorsPage
 *   CreatorFullPage
 *   CreatorDashboardPage
 *   CreatorEarningsPage
 *   CreatorSignedOutPage
 *   CreatorReelsPage
 */
'use strict';
async function submitCreatorApp(){
  // Simplified creator signup: Google One Tap fills name+email, only IG handle is manual
  var igEl=document.getElementById('cs-ig');
  var emailEl=document.getElementById('cs-email');
  var fnameEl=document.getElementById('cs-fname');
  var lnameEl=document.getElementById('cs-lname');
  var d={
    first_name:fnameEl?fnameEl.value:'',
    last_name:lnameEl?lnameEl.value:'',
    email:emailEl?emailEl.value:'',
    instagram:igEl?igEl.value.replace(/^@/,''):'',
    tiktok:'',youtube:'',followers:'',why:'quick-signup'
  };
  // If logged in via Google, auto-fill from state
  if(state.user){
    if(!d.email&&state.user.email)d.email=state.user.email;
    if(!d.first_name&&state.user.name)d.first_name=state.user.name.split(' ')[0]||'';
    if(!d.last_name&&state.user.name)d.last_name=state.user.name.split(' ').slice(1).join(' ')||'';
  }
  if(!d.email){sgToast('Please sign in with Google or enter your email','error');return;}
  try{
    var res=await fetch('/api/v2/creator-apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    var data=await res.json();
    // Generate instant referral handle from email
    var handle=d.instagram||d.email.split('@')[0].replace(/[^a-z0-9]/gi,'').toLowerCase();
    localStorage.setItem('sg_creator',JSON.stringify({handle:handle,email:d.email,name:d.first_name}));
    // Sync handle to DB for wallet reconciliation
    if(state.user)fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:handle})}).catch(function(){});
  }catch(e){}
  document.getElementById('creator-signup-form').classList.add('hidden');
  document.getElementById('creator-signup-success').classList.remove('hidden');
  // Show referral link immediately
  var linkEl=document.getElementById('cs-instant-link');
  if(linkEl){
    var h=d.instagram||d.email.split('@')[0].replace(/[^a-z0-9]/gi,'').toLowerCase();
    linkEl.textContent='scangym.com/r/'+h;
  }
  if(typeof fbq==='function')fbq('track','Lead');
  if(typeof ttq==='object')ttq.track('SubmitForm');
  if(typeof gtag==='function')gtag('event','generate_lead',{event_category:'creator_signup'});
}

function CreatorsPage(){
  // Asset paths — serve from /assets/scansquad/ on the server
  const A = '/assets/scansquad';

  // Real asset data from Google Drive
  const assets = [
    // Creator Assets (10)
    {name:'Hero Banner',file:'ScanGym-Asset1-Hero-Banner.webp',type:'image',cat:'Creator Assets'},
    {name:'Hidden Gems',file:'ScanGym-Asset10-Hidden-Gems.webp',type:'image',cat:'Creator Assets'},
    {name:'How It Works',file:'ScanGym-Asset2-How-It-Works.webp',type:'image',cat:'Creator Assets'},
    {name:'Competitor Comparison',file:'ScanGym-Asset3-Competitor-Comparison.webp',type:'image',cat:'Creator Assets'},
    {name:'DM Outreach Card',file:'ScanGym-Asset4-DM-Outreach-Card.webp',type:'image',cat:'Creator Assets'},
    {name:'Day Pass Revolution Story',file:'ScanGym-Asset5-Uber-For-Gyms-Story.webp',type:'image',cat:'Creator Assets'},
    {name:'Viral Hook',file:'ScanGym-Asset6-Viral-Hook.webp',type:'image',cat:'Creator Assets'},
    {name:'Price Comparison',file:'ScanGym-Asset7-Price-Comparison.webp',type:'image',cat:'Creator Assets'},
    {name:'Comment Bait',file:'ScanGym-Asset8-Comment-Bait.webp',type:'image',cat:'Creator Assets'},
    {name:'Gym Review Story',file:'ScanGym-Asset9-Gym-Review-Story.webp',type:'image',cat:'Creator Assets'},
    // Branded (6)
    {name:'ScanGym Legacy Avatar',file:'ScanGym-Legacy-Avatar.webp',type:'image',cat:'Branded'},
    {name:'Membership vs ScanGym',file:'ScanGym-CMO-ComparisonInfographic-MembershipVsScanGym.webp',type:'image',cat:'Branded'},
    {name:'Hero Graphic + App Mockup',file:'ScanGym-CMO-HeroGraphic-AppMockup.webp',type:'image',cat:'Branded'},
    {name:'Affiliate Earnings',file:'ScanGym-CMO-I20-AffiliateEarnings-Landscape.webp',type:'image',cat:'Branded'},
    {name:'ScanGym Soul ID Avatar',file:'ScanGym-Soul-ID-Avatar.webp',type:'image',cat:'Branded'},
    {name:'Soul ID — Founder',file:'ScanGym-Soul-ID-Mubarak.webp',type:'image',cat:'Branded'},
    // Marketing (28)
    {name:'Swipe Up Promo',file:'01_swipe_up_promo.png',type:'image',cat:'Marketing'},
    {name:'Affiliate Code',file:'03_affiliate_code.png',type:'image',cat:'Marketing'},
    {name:'Stats Story',file:'05_stats_story.png',type:'image',cat:'Marketing'},
    {name:'Bold Quote — Nike Style',file:'ScanGym-CMO-BoldQuote-NikeStyle.webp',type:'image',cat:'Marketing'},
    {name:'30-Day Challenge',file:'ScanGym-CMO-I10-30DayChallenge-Landscape.webp',type:'image',cat:'Marketing'},
    {name:'Meme Post',file:'ScanGym-CMO-I11-Meme-Square.webp',type:'image',cat:'Marketing'},
    {name:'Bolton City Promo',file:'ScanGym-CMO-I12-BoltonCityPromo-Square.webp',type:'image',cat:'Marketing'},
    {name:'Carousel Hook',file:'ScanGym-CMO-I13-CarouselHook-Square.webp',type:'image',cat:'Marketing'},
    {name:'Testimonial Review',file:'ScanGym-CMO-I14-TestimonialReview-Square.webp',type:'image',cat:'Marketing'},
    {name:'Weekend Warrior',file:'ScanGym-CMO-I15-WeekendWarrior-Landscape.webp',type:'image',cat:'Marketing'},
    {name:'Launch Offer',file:'ScanGym-CMO-I16-LaunchOffer-Square.webp',type:'image',cat:'Marketing'},
    {name:'This vs That',file:'ScanGym-CMO-I17-ThisVsThat-Square.webp',type:'image',cat:'Marketing'},
    {name:'Monday Motivation',file:'ScanGym-CMO-I18-MondayMotivation-Square.webp',type:'image',cat:'Marketing'},
    {name:'60-Sec Infographic',file:'ScanGym-CMO-I19-60SecInfographic-Vertical.webp',type:'image',cat:'Marketing'},
    {name:'Affiliate Earnings Landscape',file:'ScanGym-CMO-I20-AffiliateEarnings-Landscape.webp',type:'image',cat:'Marketing'},
    {name:'Gen Z Targeting',file:'ScanGym-CMO-I6-GenZTargeting-Square.webp',type:'image',cat:'Marketing'},
    {name:'Student Hack Story',file:'ScanGym-CMO-I7-StudentHack-VerticalStory.webp',type:'image',cat:'Marketing'},
    {name:'Social Proof Stats',file:'ScanGym-CMO-I8-SocialProofStats-Square.webp',type:'image',cat:'Marketing'},
    {name:'QR Tech Angle',file:'ScanGym-CMO-I9-QRTechAngle-Square.webp',type:'image',cat:'Marketing'},
    {name:'No Membership Story Ad',file:'ScanGym-CMO-VerticalStoryAd-NoMembership.webp',type:'image',cat:'Marketing'},
    // Social Packs (30)
    {name:'Affiliate Videos Pack 1',file:'affiliate-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Affiliate Videos Pack 2',file:'affiliate-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Affiliate Videos Pack 3',file:'affiliate-videos_3.png',type:'image',cat:'Social Packs'},
    // Marketing (28)
    {name:'Affiliate Post 1',file:'affiliate_01.png',type:'image',cat:'Marketing'},
    {name:'Affiliate Post 2',file:'affiliate_02.png',type:'image',cat:'Marketing'},
    {name:'Affiliate Post 3',file:'affiliate_03.png',type:'image',cat:'Marketing'},
    {name:'Affiliate Post 4',file:'affiliate_04.png',type:'image',cat:'Marketing'},
    // Social Packs (30)
    {name:'AI Cinematic 1',file:'ai-cinematic_1.png',type:'image',cat:'Social Packs'},
    {name:'AI Cinematic 2',file:'ai-cinematic_2.png',type:'image',cat:'Social Packs'},
    {name:'AI Cinematic 3',file:'ai-cinematic_3.png',type:'image',cat:'Social Packs'},
    // Marketing (28)
    {name:'ScanGym Widget',file:'scangym-widget-proper.png',type:'image',cat:'Marketing'},
    // Social Packs (30)
    {name:'City Promos Square 1',file:'city-promos-square_1.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Square 2',file:'city-promos-square_2.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Square 3',file:'city-promos-square_3.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 1',file:'city-promos-vertical_1.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 2',file:'city-promos-vertical_2.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 3',file:'city-promos-vertical_3.png',type:'image',cat:'Social Packs'},
    // Marketing (28)
    {name:'Comment Your City',file:'comment_your_city.png',type:'image',cat:'Marketing'},
    // Social Packs (30)
    {name:'Did You Know 1',file:'did-you-know-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Did You Know 2',file:'did-you-know-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Did You Know 3',file:'did-you-know-videos_3.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 1',file:'price-comparisons_1.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 2',file:'price-comparisons_2.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 3',file:'price-comparisons_3.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 1',file:'ready-to-post_1.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 2',file:'ready-to-post_2.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 3',file:'ready-to-post_3.png',type:'image',cat:'Social Packs'},
    // Marketing (28)
    {name:'Save This Post',file:'save_this_post.png',type:'image',cat:'Marketing'},
    // Social Packs (30)
    {name:'TikTok Reel 1',file:'tiktok-reels_1.png',type:'image',cat:'Social Packs'},
    {name:'TikTok Reel 2',file:'tiktok-reels_2.png',type:'image',cat:'Social Packs'},
    {name:'TikTok Reel 3',file:'tiktok-reels_3.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 1',file:'viral-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 2',file:'viral-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 3',file:'viral-videos_3.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 1',file:'youtube-horizontal_1.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 2',file:'youtube-horizontal_2.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 3',file:'youtube-horizontal_3.png',type:'image',cat:'Social Packs'},
    // Marketing (28)
    {name:'YouTube — Every Gym City',file:'yt_every_gym_city.png',type:'image',cat:'Marketing'},
    // Mascot (3)
    {name:'FLEX Hero Pose',file:'FLEX_01_hero_pose.jpg',type:'image',cat:'Mascot'},
    {name:'FLEX Friendly',file:'FLEX_02_friendly.jpg',type:'image',cat:'Mascot'},
    {name:'FLEX Double Bicep',file:'FLEX_03_double_bicep.jpg',type:'image',cat:'Mascot'},
    // City Promos (110)
    {name:'Birmingham — 24/7 Gym',file:'birmingham_24_7.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Boxing Gym',file:'birmingham_boxing.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — CrossFit',file:'birmingham_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Luxury Gym',file:'birmingham_luxury.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Post',file:'birmingham_post.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Story',file:'birmingham_story.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Weights',file:'birmingham_weights.png',type:'image',cat:'City Promos'},
    {name:'Birmingham — Yoga Studio',file:'birmingham_yoga.png',type:'image',cat:'City Promos'},
    {name:'Blackburn — Post',file:'blackburn_post.png',type:'image',cat:'City Promos'},
    {name:'Blackburn — Story',file:'blackburn_story.png',type:'image',cat:'City Promos'},
    {name:'Bolton — 24/7 Gym',file:'bolton_24_7.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Boxing Gym',file:'bolton_boxing.png',type:'image',cat:'City Promos'},
    {name:'Bolton — CrossFit',file:'bolton_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Luxury Gym',file:'bolton_luxury.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Post',file:'bolton_post.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Story',file:'bolton_story.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Weights',file:'bolton_weights.png',type:'image',cat:'City Promos'},
    {name:'Bolton — Yoga Studio',file:'bolton_yoga.png',type:'image',cat:'City Promos'},
    {name:'Brighton — Post',file:'brighton_post.png',type:'image',cat:'City Promos'},
    {name:'Brighton — Story',file:'brighton_story.png',type:'image',cat:'City Promos'},
    {name:'Bristol — 24/7 Gym',file:'bristol_24_7.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Boxing Gym',file:'bristol_boxing.png',type:'image',cat:'City Promos'},
    {name:'Bristol — CrossFit',file:'bristol_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Luxury Gym',file:'bristol_luxury.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Post',file:'bristol_post.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Story',file:'bristol_story.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Weights',file:'bristol_weights.png',type:'image',cat:'City Promos'},
    {name:'Bristol — Yoga Studio',file:'bristol_yoga.png',type:'image',cat:'City Promos'},
    {name:'Burnley — Post',file:'burnley_post.png',type:'image',cat:'City Promos'},
    {name:'Burnley — Story',file:'burnley_story.png',type:'image',cat:'City Promos'},
    {name:'Bury — Post',file:'bury_post.png',type:'image',cat:'City Promos'},
    {name:'Bury — Story',file:'bury_story.png',type:'image',cat:'City Promos'},
    {name:'Cardiff — Post',file:'cardiff_post.png',type:'image',cat:'City Promos'},
    {name:'Cardiff — Story',file:'cardiff_story.png',type:'image',cat:'City Promos'},
    {name:'Edinburgh — Post',file:'edinburgh_post.png',type:'image',cat:'City Promos'},
    {name:'Edinburgh — Story',file:'edinburgh_story.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — 24/7 Gym',file:'glasgow_24_7.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Boxing Gym',file:'glasgow_boxing.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — CrossFit',file:'glasgow_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Luxury Gym',file:'glasgow_luxury.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Post',file:'glasgow_post.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Story',file:'glasgow_story.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Weights',file:'glasgow_weights.png',type:'image',cat:'City Promos'},
    {name:'Glasgow — Yoga Studio',file:'glasgow_yoga.png',type:'image',cat:'City Promos'},
    {name:'Leeds — 24/7 Gym',file:'leeds_24_7.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Boxing Gym',file:'leeds_boxing.png',type:'image',cat:'City Promos'},
    {name:'Leeds — CrossFit',file:'leeds_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Luxury Gym',file:'leeds_luxury.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Post',file:'leeds_post.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Story',file:'leeds_story.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Weights',file:'leeds_weights.png',type:'image',cat:'City Promos'},
    {name:'Leeds — Yoga Studio',file:'leeds_yoga.png',type:'image',cat:'City Promos'},
    {name:'Leicester — Post',file:'leicester_post.png',type:'image',cat:'City Promos'},
    {name:'Leicester — Story',file:'leicester_story.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — 24/7 Gym',file:'liverpool_24_7.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Boxing Gym',file:'liverpool_boxing.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — CrossFit',file:'liverpool_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Luxury Gym',file:'liverpool_luxury.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Post',file:'liverpool_post.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Story',file:'liverpool_story.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Weights',file:'liverpool_weights.png',type:'image',cat:'City Promos'},
    {name:'Liverpool — Yoga Studio',file:'liverpool_yoga.png',type:'image',cat:'City Promos'},
    {name:'London — 24/7 Gym',file:'london_24_7.png',type:'image',cat:'City Promos'},
    {name:'London — Boxing Gym',file:'london_boxing.png',type:'image',cat:'City Promos'},
    {name:'London — CrossFit',file:'london_crossfit.png',type:'image',cat:'City Promos'},
    {name:'London — Luxury Gym',file:'london_luxury.png',type:'image',cat:'City Promos'},
    {name:'London — Post',file:'london_post.png',type:'image',cat:'City Promos'},
    {name:'London — Story',file:'london_story.png',type:'image',cat:'City Promos'},
    {name:'London — Weights',file:'london_weights.png',type:'image',cat:'City Promos'},
    {name:'London — Yoga Studio',file:'london_yoga.png',type:'image',cat:'City Promos'},
    {name:'Manchester — 24/7 Gym',file:'manchester_24_7.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Boxing Gym',file:'manchester_boxing.png',type:'image',cat:'City Promos'},
    {name:'Manchester — CrossFit',file:'manchester_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Luxury Gym',file:'manchester_luxury.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Post',file:'manchester_post.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Story',file:'manchester_story.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Weights',file:'manchester_weights.png',type:'image',cat:'City Promos'},
    {name:'Manchester — Yoga Studio',file:'manchester_yoga.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — 24/7 Gym',file:'newcastle_24_7.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Boxing Gym',file:'newcastle_boxing.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — CrossFit',file:'newcastle_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Luxury Gym',file:'newcastle_luxury.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Post',file:'newcastle_post.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Story',file:'newcastle_story.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Weights',file:'newcastle_weights.png',type:'image',cat:'City Promos'},
    {name:'Newcastle — Yoga Studio',file:'newcastle_yoga.png',type:'image',cat:'City Promos'},
    {name:'Nottingham — Post',file:'nottingham_post.png',type:'image',cat:'City Promos'},
    {name:'Nottingham — Story',file:'nottingham_story.png',type:'image',cat:'City Promos'},
    {name:'Oldham — Post',file:'oldham_post.png',type:'image',cat:'City Promos'},
    {name:'Oldham — Story',file:'oldham_story.png',type:'image',cat:'City Promos'},
    {name:'Preston — Post',file:'preston_post.png',type:'image',cat:'City Promos'},
    {name:'Preston — Story',file:'preston_story.png',type:'image',cat:'City Promos'},
    {name:'Rochdale — Post',file:'rochdale_post.png',type:'image',cat:'City Promos'},
    {name:'Rochdale — Story',file:'rochdale_story.png',type:'image',cat:'City Promos'},
    {name:'Salford — Post',file:'salford_post.png',type:'image',cat:'City Promos'},
    {name:'Salford — Story',file:'salford_story.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — 24/7 Gym',file:'sheffield_24_7.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Boxing Gym',file:'sheffield_boxing.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — CrossFit',file:'sheffield_crossfit.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Luxury Gym',file:'sheffield_luxury.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Post',file:'sheffield_post.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Story',file:'sheffield_story.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Weights',file:'sheffield_weights.png',type:'image',cat:'City Promos'},
    {name:'Sheffield — Yoga Studio',file:'sheffield_yoga.png',type:'image',cat:'City Promos'},
    {name:'Southampton — Post',file:'southampton_post.png',type:'image',cat:'City Promos'},
    {name:'Southampton — Story',file:'southampton_story.png',type:'image',cat:'City Promos'},
    {name:'Stockport — Post',file:'stockport_post.png',type:'image',cat:'City Promos'},
    {name:'Stockport — Story',file:'stockport_story.png',type:'image',cat:'City Promos'},
    {name:'Wigan — Post',file:'wigan_post.png',type:'image',cat:'City Promos'},
    {name:'Wigan — Story',file:'wigan_story.png',type:'image',cat:'City Promos'},
    // Story Templates (6)
    {name:'Story — Affiliate',file:'story_affiliate.png',type:'image',cat:'Story Templates'},
    {name:'Story — Before & After',file:'story_before_after.png',type:'image',cat:'Story Templates'},
    {name:'Story — Countdown',file:'story_countdown.png',type:'image',cat:'Story Templates'},
    {name:'Story — Gym Tour',file:'story_gym_tour.png',type:'image',cat:'Story Templates'},
    {name:'Story — Price Drop',file:'story_price_drop.png',type:'image',cat:'Story Templates'},
    {name:'Story — Swipe to Gym',file:'story_swipe_gym.png',type:'image',cat:'Story Templates'},
    // Social Covers (7)
    {name:'Banner 1',file:'banner_01.png',type:'image',cat:'Social Covers'},
    {name:'Banner 2',file:'banner_02.png',type:'image',cat:'Social Covers'},
    {name:'Banner 3',file:'banner_03.png',type:'image',cat:'Social Covers'},
    {name:'Banner 4',file:'banner_04.png',type:'image',cat:'Social Covers'},
    {name:'Facebook Cover',file:'fb_cover.png',type:'image',cat:'Social Covers'},
    {name:'LinkedIn Cover',file:'linkedin_cover.png',type:'image',cat:'Social Covers'},
    {name:'Twitter/X Banner',file:'twitter_banner.png',type:'image',cat:'Social Covers'},
    // Promo Videos (24)
    {name:'Contrarian Hook: "Gym Scam"',file:'01_contrarian_hook_gym_scam_1080p.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gen Z Day Pass Journey',file:'02_gen_z_day_pass_journey.mp4',type:'video',cat:'Promo Videos'},
    {name:'Day Pass Gym Challenge',file:'03_five_pound_challenge.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gym Hopper (YouTube 16:9)',file:'04_gym_hopper_youtube_16x9.mp4',type:'video',cat:'Promo Videos'},
    {name:'Stop Paying Full Price',file:'05_stop_paying_imperative.mp4',type:'video',cat:'Promo Videos'},
    {name:'Travelling? Find a Gym',file:'06_travelling_gym_finder.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gym Membership Trap',file:'07_gym_membership_trap.mp4',type:'video',cat:'Promo Videos'},
    {name:'Day Pass Gym Tour London',file:'08_five_pound_gym_tour_london.mp4',type:'video',cat:'Promo Videos'},
    {name:'Before & After Gym Hopper',file:'09_before_after_gym_hopper.mp4',type:'video',cat:'Promo Videos'},
    {name:'ScanGym App Demo',file:'10_scangym_app_demo.mp4',type:'video',cat:'Promo Videos'},
    {name:'CrossFit Box Hop',file:'11_crossfit_box_hop.mp4',type:'video',cat:'Promo Videos'},
    {name:'Manchester Gym Scene',file:'12_manchester_gym_scene.mp4',type:'video',cat:'Promo Videos'},
    {name:'Birmingham Gym Discovery',file:'13_birmingham_gym_discovery.mp4',type:'video',cat:'Promo Videos'},
    {name:'Student Gym Hack',file:'14_student_gym_hack.mp4',type:'video',cat:'Promo Videos'},
    {name:'Yoga Studio Hop',file:'15_yoga_studio_hop.mp4',type:'video',cat:'Promo Videos'},
    {name:'Membership vs Day Pass Comparison',file:'16_fifty_vs_five_comparison.mp4',type:'video',cat:'Promo Videos'},
    {name:'Edinburgh Fitness Scene',file:'17_edinburgh_fitness_scene.mp4',type:'video',cat:'Promo Videos'},
    {name:'Morning Routine w/ ScanGym',file:'18_morning_routine_scangym.mp4',type:'video',cat:'Promo Videos'},
    {name:'Leeds Gym Crawl',file:'19_leeds_gym_crawl.mp4',type:'video',cat:'Promo Videos'},
    {name:'Couples Gym Date',file:'20_couples_gym_date.mp4',type:'video',cat:'Promo Videos'},
    {name:'Late Night Gym Finder',file:'21_late_night_gym_finder.mp4',type:'video',cat:'Promo Videos'},
    {name:'Glasgow Gym Culture',file:'22_glasgow_gym_culture.mp4',type:'video',cat:'Promo Videos'},
    {name:'Bodybuilder Budget Gyms',file:'23_bodybuilder_budget_gyms.mp4',type:'video',cat:'Promo Videos'},
    {name:'Save Money Calculator',file:'24_save_money_calculator.mp4',type:'video',cat:'Promo Videos'},
    // CMO Content (18)
    {name:'Reaction Duet',file:'ScanGym-CMO-V10-ReactionDuet-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Recovery Trend',file:'ScanGym-CMO-V11-RecoveryTrend-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Form Check',file:'ScanGym-CMO-V12-FormCheck-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Couple Goals',file:'ScanGym-CMO-V13-CoupleGoals-Horizontal.mp4',type:'video',cat:'CMO Content'},
    {name:'POV: First Gym Visit',file:'ScanGym-CMO-V14-POVFirstGym-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Travel Fitness',file:'ScanGym-CMO-V15-TravelFitness-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'GRWM Gym Edition',file:'ScanGym-CMO-V16-GRWM-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Storytime: Gym Discovery',file:'ScanGym-CMO-V17-Storytime-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Gym Tour Walkthrough',file:'ScanGym-CMO-V18-GymTour-Horizontal.mp4',type:'video',cat:'CMO Content'},
    {name:'Expert Explainer',file:'ScanGym-CMO-V4-ExpertExplainer-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Walk & Talk',file:'ScanGym-CMO-V5-WalkAndTalk-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Specific Number Hook',file:'ScanGym-CMO-V6-SpecificNumber-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Desk to Dumbbell',file:'ScanGym-CMO-V7-DeskToDumbbell-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Myth Bust',file:'ScanGym-CMO-V8-MythBust-Horizontal.mp4',type:'video',cat:'CMO Content'},
    {name:'Imperative Command',file:'ScanGym-CMO-V9-ImperativeCommand-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Contrarian Hook',file:'ScanGym-CMO-Video1-ContrarianHook-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Outcome Showcase',file:'ScanGym-CMO-Video2-OutcomeShowcase-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Brand Story',file:'ScanGym-CMO-Video3-BrandStory-Horizontal.mp4',type:'video',cat:'CMO Content'},

    // — AI Cinematic —
    {name:'Affiliateearnings V1',file:'AffiliateEarnings_v1.mp4',type:'video',cat:'AI Cinematic',did:'1JMfgsU-DVxBo4vMM8Fx8o-FjnP8Yr2mw'},
    {name:'Ba Ninetydays',file:'BA-NinetyDays.mp4',type:'video',cat:'AI Cinematic',did:'14qGrzVq8kvTliPnSQoaiUIjm0Hw0P_Nn'},
    {name:'Ba Theconfidence',file:'BA-TheConfidence.mp4',type:'video',cat:'AI Cinematic',did:'1XHulXapWoA1XuFoBvBsyQBemPnfpr0B-'},
    {name:'Ba Thehoodie',file:'BA-TheHoodie.mp4',type:'video',cat:'AI Cinematic',did:'1rQOVfHT5Dy-PGQbno7fuR0gWipQ2qhQK'},
    {name:'Ba Thephoto',file:'BA-ThePhoto.mp4',type:'video',cat:'AI Cinematic',did:'1P90bsAdELVh7h3cNAtSQN5iI4_2ODxrk'},
    {name:'Ba Twoversions',file:'BA-TwoVersions.mp4',type:'video',cat:'AI Cinematic',did:'1tRAhop-c9Ui3af5YT6WsjGhF0QWJadds'},
    {name:'Bk Membershiptrap',file:'BK-MembershipTrap.mp4',type:'video',cat:'AI Cinematic',did:'10TneS_GV9F0CODrsiojCEKM9TAQbnzDY'},
    {name:'Bk Sixtygyms',file:'BK-SixtyGyms.mp4',type:'video',cat:'AI Cinematic',did:'175vNYNv-Wu58w57L95wc4dtJm-JZWJp4'},
    {name:'Bk Theflex',file:'BK-TheFlex.mp4',type:'video',cat:'AI Cinematic',did:'1mIMKcvTr24KA4cx5lTlo-vuCDRVzTKAA'},
    {name:'Bk Thesecret',file:'BK-TheSecret.mp4',type:'video',cat:'AI Cinematic',did:'1oHr9W4rOKv4LPmngaB39oCv4iIRdQy_7'},
    {name:'Bk Thevisitors',file:'BK-TheVisitors.mp4',type:'video',cat:'AI Cinematic',did:'15uWummktfl3h1j1QqUCbZO7QfJNwHLWh'},
    {name:'Bs Summercoming',file:'BS-SummerComing.mp4',type:'video',cat:'AI Cinematic',did:'1NaJjtVW1-sXC-za7xDGwgWxhlDARiKQk'},
    {name:'Bs Thestandard',file:'BS-TheStandard.mp4',type:'video',cat:'AI Cinematic',did:'1FXBQSCRvfbPMzbYc2YHk7wt_2Y0shHy1'},
    {name:'Beforeafter Freedom V1',file:'BeforeAfter_Freedom_v1.mp4',type:'video',cat:'AI Cinematic',did:'1OcD5sScpPjX4Cg8xbRkH1Tb6Qxne3pHM'},
    {name:'Beforeafter Wallet V2',file:'BeforeAfter_Wallet_v2.mp4',type:'video',cat:'AI Cinematic',did:'1hxhKrDnEygynFHIV9voJo_pZdfhfnWVq'},
    {name:'C01 Huberman Clip',file:'C01_Huberman_Clip.mp4',type:'video',cat:'AI Cinematic',did:'1rr25WANPegwL6fV_Lm9F0e8sINLgxd7J'},
    {name:'Cq Thefeeling',file:'CQ-TheFeeling.mp4',type:'video',cat:'AI Cinematic',did:'1_6E-fDKBsqc1E0CyQ4D_JUA-9UtF1pdL'},
    {name:'Cq Themirror',file:'CQ-TheMirror.mp4',type:'video',cat:'AI Cinematic',did:'1Obb1Jgh-nqHwSyJSKl1N1438PbZ0t1sM'},
    {name:'Cq Therestart',file:'CQ-TheRestart.mp4',type:'video',cat:'AI Cinematic',did:'1bkrAk3jbBumfXI6UKgvot0nceKTqlgNo'},
    {name:'Cq Theversion',file:'CQ-TheVersion.mp4',type:'video',cat:'AI Cinematic',did:'1kkBb4NNwPWWtuCZuEH89TkHwKExuVeoO'},
    {name:'Cq Twoweeks',file:'CQ-TwoWeeks.mp4',type:'video',cat:'AI Cinematic',did:'1VpIn-WPggkwWCnoMQHtFkxK9fVqnDbqX'},
    {name:'Cw Hemsworth',file:'CW-Hemsworth.mp4',type:'video',cat:'AI Cinematic',did:'1lI0O5YIM6CiuyKo5SmgjjSVAjA1duFrn'},
    {name:'Cw Ronaldo',file:'CW-Ronaldo.mp4',type:'video',cat:'AI Cinematic',did:'1hLspfbjMfJzPqFQNh5IGqirzHrD1jZhE'},
    {name:'Cw Therock',file:'CW-TheRock.mp4',type:'video',cat:'AI Cinematic',did:'1GOgSfb1r1dZeW0XI1xTWgd7OUJQ7RpmX'},
    {name:'Cw Tyson',file:'CW-Tyson.mp4',type:'video',cat:'AI Cinematic',did:'1SNDb_EI0T0yxJi-ZdJUFlMM_ubAzjcrO'},
    {name:'Cw Zyzz',file:'CW-Zyzz.mp4',type:'video',cat:'AI Cinematic',did:'19HsD1KGWQn8dHZ7skt0IKObWnkE3rEn-'},
    {name:'Fc Thebet',file:'FC-TheBet.mp4',type:'video',cat:'AI Cinematic',did:'1qc9rSB2UbFbmu-Yty0qRAmaFVoWuQiyu'},
    {name:'Fc Thedare',file:'FC-TheDare.mp4',type:'video',cat:'AI Cinematic',did:'1IyjCFP4bFrdx6ZnBI1htTBE21aH08Rui'},
    {name:'Fc Theexcuses',file:'FC-TheExcuses.mp4',type:'video',cat:'AI Cinematic',did:'1rnX4nvhbJmiHZl6qDGB1PY3L3ICznt9W'},
    {name:'Fc Theexperiment',file:'FC-TheExperiment.mp4',type:'video',cat:'AI Cinematic',did:'1vWGSY2GfCIJA6VhpbxGD6ancxVBrcdPz'},
    {name:'Fc Thetag',file:'FC-TheTag.mp4',type:'video',cat:'AI Cinematic',did:'1b2rbmczWzHZE3rLWjELeG_HlD6jPiV-V'},
    {name:'Fs Sixmonths',file:'FS-SixMonths.mp4',type:'video',cat:'AI Cinematic',did:'1aCOtZYsPQ_72n_9PXew4-_bXL2zTQIAb'},
    {name:'Fs Thedecision',file:'FS-TheDecision.mp4',type:'video',cat:'AI Cinematic',did:'1UNJguCSENdyX9-vrmGtPvFW22mCSEIex'},
    {name:'Fs Theletter',file:'FS-TheLetter.mp4',type:'video',cat:'AI Cinematic',did:'1ZDNOtD5nDac8knNzo21oMskgWcKq_mvv'},
    {name:'Fs Thepromise',file:'FS-ThePromise.mp4',type:'video',cat:'AI Cinematic',did:'1JJest9YBq0Rk_TVd_CrwhYniH3KOCWQV'},
    {name:'Fs Thethankyou',file:'FS-TheThankYou.mp4',type:'video',cat:'AI Cinematic',did:'1lnUPljdQrp9i87prbL6I-s-mFdnP_3hZ'},
    {name:'Gh Atmosphere',file:'GH-Atmosphere.mp4',type:'video',cat:'AI Cinematic',did:'1oWh8GZA2tek2xb2QjOTd7K_dz0w8Iuse'},
    {name:'Gh Discipline',file:'GH-Discipline.mp4',type:'video',cat:'AI Cinematic',did:'1bXEoEeVJZx7n4CZnxryFniklvYXISENq'},
    {name:'Gh Equipment',file:'GH-Equipment.mp4',type:'video',cat:'AI Cinematic',did:'1P7272qMHB0qhV5V36fTfCoG6K1lsmkff'},
    {name:'Gh Results',file:'GH-Results.mp4',type:'video',cat:'AI Cinematic',did:'1DaD9boo2Aip06ZXzrKSRJJYWB7IaEIaN'},
    {name:'Gh Thetruth',file:'GH-TheTruth.mp4',type:'video',cat:'AI Cinematic',did:'14eLe5H8dVOl_ziYKr7Zpzl8jB482WOO-'},
    {name:'Gs Theanxiety',file:'GS-TheAnxiety.mp4',type:'video',cat:'AI Cinematic',did:'1UjHqcgjw6Kp_PEK2IuFc5z7F2f9Mdpfr'},
    {name:'Gs Thebreakup',file:'GS-TheBreakup.mp4',type:'video',cat:'AI Cinematic',did:'15Ni2KAojPjfZeK6MLbZkjlLDTrtCvlJs'},
    {name:'Gs Theconfidence',file:'GS-TheConfidence.mp4',type:'video',cat:'AI Cinematic',did:'1TW9OXqywKLmFqHTnOb4xzpp1o-3tPbj9'},
    {name:'Gs Thedarkplace',file:'GS-TheDarkPlace.mp4',type:'video',cat:'AI Cinematic',did:'1lGkKA7ED2YiX5YAFqc0CYbD28xp1C4Ro'},
    {name:'Gs Thediscipline',file:'GS-TheDiscipline.mp4',type:'video',cat:'AI Cinematic',did:'1pNa6kXaA1bj5L5ejH2-LdKepYNiMvGYY'},
    // — Audience Posts —
    {name:'Beginners',file:'beginners.png',type:'image',cat:'Audience Posts',did:'1wk2m6-x7ZLK5d3zs2mlvz4ArWU-yf6SC'},
    {name:'Busy Professionals',file:'busy_professionals.png',type:'image',cat:'Audience Posts',did:'1xOq7eKqwabRfkcPnhTaqDG53KOD69kvH'},
    {name:'Couples',file:'couples.png',type:'image',cat:'Audience Posts',did:'1S_3inRe4l62MiiAyQm6O9WhPkk9o5ycO'},
    {name:'Gym Hoppers',file:'gym_hoppers.png',type:'image',cat:'Audience Posts',did:'1PCyTFqz5hQ7rPF_NOjhbWVHOZ9OCKHya'},
    {name:'Parents',file:'parents.png',type:'image',cat:'Audience Posts',did:'1Ev7NzIoxOc52rwBUj3PZ2N3RrBI4xSYN'},
    {name:'Runners',file:'runners.png',type:'image',cat:'Audience Posts',did:'1BV0Ws9kn-WCwGPvi0vysk-zXAvL6Qbsk'},
    {name:'Seniors',file:'seniors.png',type:'image',cat:'Audience Posts',did:'1k_RbnQpCkvDd8oL1vDBTL3-xeI_iDOZL'},
    {name:'Shift Workers',file:'shift_workers.png',type:'image',cat:'Audience Posts',did:'10wjqfN0mDKqNSxTLJdd-3xBfPEAUr4i1'},
    {name:'Students',file:'students.png',type:'image',cat:'Audience Posts',did:'1BY3hAQEHiMzGlzQcLAobo6NNg82cP4ew'},
    {name:'Travellers',file:'travellers.png',type:'image',cat:'Audience Posts',did:'1YZprr50ZvHzt6s2-akf8wRVXr36d1JHv'},
    // — Banners —
    {name:'How It Works 01',file:'how_it_works_01.png',type:'image',cat:'Banners',did:'1ulRFDc58CBfiAUYVgete4S_m0tG0lSf0'},
    {name:'How It Works 02',file:'how_it_works_02.png',type:'image',cat:'Banners',did:'1WD845sApCyggWxpBO2blPrucl1hRsp8d'},
    // — CTA Templates —
    {name:'Dm Us Gym',file:'dm_us_gym.png',type:'image',cat:'CTA Templates',did:'1OB8aIT_cOj-8UwSlNMw-Eo2ko7_E2bbq'},
    {name:'Drop A 💪',file:'drop_a_💪.png',type:'image',cat:'CTA Templates',did:'10QQbl84DZ-CUlpWx6igfg7dE1x-l4g9z'},
    {name:'Link In Bio',file:'link_in_bio.png',type:'image',cat:'CTA Templates',did:'1QhtDCleeux7DjDoZD2NphiewFMSO8eKr'},
    {name:'Share Your Code',file:'share_your_code.png',type:'image',cat:'CTA Templates',did:'1uZJ9bZ9epZ1Z2coIMpJ9bMICm_1XwHeV'},
    {name:'Swipe Left',file:'swipe_left.png',type:'image',cat:'CTA Templates',did:'1QZvzM3nMwTCFVgiRF8fcjxS23LwbV4P1'},
    {name:'Tag A Friend',file:'tag_a_friend.png',type:'image',cat:'CTA Templates',did:'1HhXlZsloqFYazP15QtDPB4rwXJBZPMvd'},
    // — City Promo Reels —
    {name:'Aberdeen',file:'aberdeen.mp4',type:'video',cat:'City Promo Reels',did:'1URhD9IwlQKssnYxOekQvrtHqnx-yFFRD'},
    {name:'Bath',file:'bath.mp4',type:'video',cat:'City Promo Reels',did:'18r4Qkmkg4LZexxeiCIXS7uStiDUr2-lG'},
    {name:'Brighton',file:'brighton.mp4',type:'video',cat:'City Promo Reels',did:'12znCMuuwT9bP0AyBVbPVQS79XS4d2ZA2'},
    {name:'Cambridge',file:'cambridge.mp4',type:'video',cat:'City Promo Reels',did:'12YvPdDUuX48R-WdAhTIZqTFfEc3eZhG6'},
    {name:'Cardiff',file:'cardiff.mp4',type:'video',cat:'City Promo Reels',did:'1mrl1zTdua8SZAhMMVWLrLZDHmCZFJezC'},
    {name:'Coventry',file:'coventry.mp4',type:'video',cat:'City Promo Reels',did:'1hA7rv6k8YK9FtTQf-0dz1xrzlPqKdiPZ'},
    {name:'Derby',file:'derby.mp4',type:'video',cat:'City Promo Reels',did:'1QbkYHAI63p1xccEWhsS3OlNJdRO3qOH7'},
    {name:'Edinburgh',file:'edinburgh.mp4',type:'video',cat:'City Promo Reels',did:'1ZzsBU6waaUpzgRTSWGYpQ82blwIAfUtb'},
    {name:'Leicester',file:'leicester.mp4',type:'video',cat:'City Promo Reels',did:'1_L1voCOKk9GdxSQaFQWFJvGehdYFVeUk'},
    {name:'Nottingham',file:'nottingham.mp4',type:'video',cat:'City Promo Reels',did:'1rLYsLCQ7h07M6IqYo7KSgcBWiu3pKu7v'},
    {name:'Oxford',file:'oxford.mp4',type:'video',cat:'City Promo Reels',did:'1_QW0JfGrf9xM1i-T9sawEyGtiO5uROm3'},
    {name:'Plymouth',file:'plymouth.mp4',type:'video',cat:'City Promo Reels',did:'10HiYXq6ClBZz5a0-OSZkcJyO7fkp70Jp'},
    {name:'Reading',file:'reading.mp4',type:'video',cat:'City Promo Reels',did:'19s7RiYp7nwjPVKrb1eC_ORyrR1y-6ngC'},
    {name:'Southampton',file:'southampton.mp4',type:'video',cat:'City Promo Reels',did:'1yrDSBxIYVVrnA6Q_fIBYea9mV8tYpwgI'},
    {name:'York',file:'york.mp4',type:'video',cat:'City Promo Reels',did:'1P7Iv5pwcceky4QILmkLyG2655h22PY0c'},
    // — City Promo Square —
    {name:'Birmingham',file:'birmingham.mp4',type:'video',cat:'City Promo Square',did:'1BHgjQPKHze1XhatWKZjGPEvR7E0g-EYi'},
    {name:'Bolton',file:'bolton.mp4',type:'video',cat:'City Promo Square',did:'1sqou-YOcC63JKm5azih29wzpfBZFiFGY'},
    {name:'Bristol',file:'bristol.mp4',type:'video',cat:'City Promo Square',did:'1tmJgeHfn0770-HSe-K3ezMgqNdx6kxa9'},
    {name:'Glasgow',file:'glasgow.mp4',type:'video',cat:'City Promo Square',did:'1AkrS9QR-EPkgbzWbOkIWbjqlWGSQAnjp'},
    {name:'Leeds',file:'leeds.mp4',type:'video',cat:'City Promo Square',did:'1O5H-2TcOWdhJfv_F6L7p42_7tidgfY_a'},
    {name:'Liverpool',file:'liverpool.mp4',type:'video',cat:'City Promo Square',did:'1TWJLCehaTnAWlfkNDIANQu-MNhj3cL01'},
    {name:'London',file:'london.mp4',type:'video',cat:'City Promo Square',did:'1M9Cta-MFMYNgX92vyIiSYrG6ovePRMXb'},
    {name:'Manchester',file:'manchester.mp4',type:'video',cat:'City Promo Square',did:'1qC1_8yzouxIOoNMeCVCYldgBXd5m8-No'},
    {name:'Newcastle',file:'newcastle.mp4',type:'video',cat:'City Promo Square',did:'15_AxMYLKYfkOSmdfeBptVsA7E6lJtIdc'},
    {name:'Sheffield',file:'sheffield.mp4',type:'video',cat:'City Promo Square',did:'1msdOr3V2NzucZPaXfZ6Gf40CiIPR7Q7n'},
    // — Daily Motivation —
    {name:'Friday',file:'friday.png',type:'image',cat:'Daily Motivation',did:'1JKObKl8l5RTW_ikOSD9ambcjASmbQ2tm'},
    {name:'Monday',file:'monday.png',type:'image',cat:'Daily Motivation',did:'1UqTM9sJqVnaimGHTycG3uDdjnjX4GHQU'},
    {name:'Saturday',file:'saturday.png',type:'image',cat:'Daily Motivation',did:'1EQDHsVghTlpzZNCMwuoJv39ash_PuN37'},
    {name:'Sunday',file:'sunday.png',type:'image',cat:'Daily Motivation',did:'1AYOa1A0gBFoFHI_NEC_mF7OmVdyFimHp'},
    {name:'Thursday',file:'thursday.png',type:'image',cat:'Daily Motivation',did:'1Rta5qvw5ItEk5yHEyRsEm8WJ3hELijAC'},
    {name:'Tuesday',file:'tuesday.png',type:'image',cat:'Daily Motivation',did:'1ee2zUH4tp732gF0WcN6YfiuOmo8phxm5'},
    {name:'Wednesday',file:'wednesday.png',type:'image',cat:'Daily Motivation',did:'1JsC1y9XnDcxEfcXltyccOsZeCO0FPwzw'},
    // — Did You Know —
    {name:'Fact 01',file:'fact_01.png',type:'image',cat:'Did You Know',did:'1eU9-MFaBIDcTSFjwmu54Y2kTQL0GB4iy'},
    {name:'Fact 02',file:'fact_02.png',type:'image',cat:'Did You Know',did:'132_mf-hZ-GrB1BB6u3f_4bzl-62fHiQ7'},
    {name:'Fact 03',file:'fact_03.png',type:'image',cat:'Did You Know',did:'1P4p-OjUYBtOUw5VbXvO8ACtE4EMInhWR'},
    {name:'Fact 04',file:'fact_04.png',type:'image',cat:'Did You Know',did:'1sAwQVwlrVEBLugFzxMatbsdwwwMZhPvU'},
    {name:'Fact 05',file:'fact_05.png',type:'image',cat:'Did You Know',did:'1Vwv_rQLRysKyQIlJGE97eLF8QrwMZi1-'},
    {name:'Fact 06',file:'fact_06.png',type:'image',cat:'Did You Know',did:'1QR8B5nNLiiMicEY5WWkzpiO8yLMy0HWd'},
    {name:'Fact 07',file:'fact_07.png',type:'image',cat:'Did You Know',did:'15EQgsUqPT2s8v-4kuni3poiGMMNsin_5'},
    {name:'Fact 08',file:'fact_08.png',type:'image',cat:'Did You Know',did:'1oTZGz20as3soTbuvyGPNvmp0vS07RR19'},
    // — Did You Know Videos —
    {name:'Fact 01',file:'fact_01.mp4',type:'video',cat:'Did You Know Videos',did:'1MLc-tAvDPDbjgecyPBnNKiEUK6dyjVtt'},
    {name:'Fact 02',file:'fact_02.mp4',type:'video',cat:'Did You Know Videos',did:'1biiI7HBewph3jCVrgZAocQzag9jV8mta'},
    {name:'Fact 03',file:'fact_03.mp4',type:'video',cat:'Did You Know Videos',did:'1-wS_KqPhqV6qE10vYSGivLUFtO5VqETf'},
    {name:'Fact 04',file:'fact_04.mp4',type:'video',cat:'Did You Know Videos',did:'1E5a2TntgtrFV5Eh3vzbHOEUt9IQLuYLR'},
    {name:'Fact 05',file:'fact_05.mp4',type:'video',cat:'Did You Know Videos',did:'1GGHvFiwTYk9a1xBZ-IB5_eRojiIVWNc2'},
    {name:'Fact 06',file:'fact_06.mp4',type:'video',cat:'Did You Know Videos',did:'1yn2rWsqOSknWb8ov4Kobg7ceg7qn94hf'},
    {name:'Fact 07',file:'fact_07.mp4',type:'video',cat:'Did You Know Videos',did:'1x1DeY2MVXqPC1R-WUkByliHs-CAali-6'},
    {name:'Fact 08',file:'fact_08.mp4',type:'video',cat:'Did You Know Videos',did:'1vBTnrgJ_kxxWbt4SQa_bqir5BjHEuMAe'},
    // — Engagement Posts —
    {name:'This Or That 01',file:'this_or_that_01.png',type:'image',cat:'Engagement Posts',did:'1dFDbH43km_cQB3odIAGytwXs0GIuIVKJ'},
    {name:'This Or That 02',file:'this_or_that_02.png',type:'image',cat:'Engagement Posts',did:'1_FGmC8sa1Gmx9qRqcQWvRpBiAgvNpxE8'},
    {name:'This Or That 03',file:'this_or_that_03.png',type:'image',cat:'Engagement Posts',did:'1i19MQSUvhcN4HIsYxx407aC6O1DXndeC'},
    {name:'This Or That 04',file:'this_or_that_04.png',type:'image',cat:'Engagement Posts',did:'1VUy4XzZJMX1vzdtGjqMrDn37iczDcz9y'},
    {name:'This Or That 05',file:'this_or_that_05.png',type:'image',cat:'Engagement Posts',did:'1MMtrONh71JfV55_4lJS6h2V6XKpIgOhR'},
    {name:'This Or That 06',file:'this_or_that_06.png',type:'image',cat:'Engagement Posts',did:'1HqjU7TuTTxgFYUrVnho8XUAn_jJQhC9Q'},
    {name:'This Or That 07',file:'this_or_that_07.png',type:'image',cat:'Engagement Posts',did:'171z_wPTpQaBQzSfRoRM916bvxyDwkG63'},
    {name:'This Or That 08',file:'this_or_that_08.png',type:'image',cat:'Engagement Posts',did:'1BvsK8RRDsnltfGz_GuxA5UQRHRd5kmNW'},
    // — General Videos —
    {name:'01 Tiktok Hook Vertical',file:'01_tiktok_hook_vertical.mp4',type:'video',cat:'General Videos',did:'14RCOl8H16PppoIKZazIswuB1oQcAIKHZ'},
    {name:'02 Gym Lifestyle Vertical',file:'02_gym_lifestyle_vertical.mp4',type:'video',cat:'General Videos',did:'1wPEvZDkpoe-wU49-VwoG7vevhTBMC5cU'},
    {name:'03 Youtube Ad Horizontal',file:'03_youtube_ad_horizontal.mp4',type:'video',cat:'General Videos',did:'1coHwPHWQMEQ3jjf3wqbZHLLqbsuthefm'},
    // — Gym Spotlights —
    {name:'24 7 Gym Card',file:'24_7_gym_card.png',type:'image',cat:'Gym Spotlights',did:'1IDire8pcXp1wDr58elDuk_T4bqs5rLz0'},
    {name:'Boxing Card',file:'boxing_card.png',type:'image',cat:'Gym Spotlights',did:'1nh2ufKRlhBGIMcBN7_NpraDnHSBjGYG_'},
    {name:'Calisthenics Card',file:'calisthenics_card.png',type:'image',cat:'Gym Spotlights',did:'1HxLAa6yvr9Kt2pr589WXZdEAGCFB7RZA'},
    {name:'Crossfit Card',file:'crossfit_card.png',type:'image',cat:'Gym Spotlights',did:'1xXjCh04Nj_2-x4JHF7MM_E8YadeeU3HN'},
    {name:'Cycling Card',file:'cycling_card.png',type:'image',cat:'Gym Spotlights',did:'1IGlYKMRYkAAYYCNpZzGovU4jXOwVX2DO'},
    {name:'Hiit Card',file:'hiit_card.png',type:'image',cat:'Gym Spotlights',did:'196b01kk9zTk3uYhQqv7lA4UCan1P8bs2'},
    {name:'Luxury Card',file:'luxury_card.png',type:'image',cat:'Gym Spotlights',did:'1YAdwzxA8g-4dG6J0XAd6uBpF_4oSUE0u'},
    {name:'Mma Card',file:'mma_card.png',type:'image',cat:'Gym Spotlights',did:'173intemxFPzDtpuM2gVcki8O8yQQZ5ij'},
    {name:'Pilates Card',file:'pilates_card.png',type:'image',cat:'Gym Spotlights',did:'1Z1-XHN829tWdH0d9ExzuMnqsjBguHFdW'},
    {name:'Swimming Card',file:'swimming_card.png',type:'image',cat:'Gym Spotlights',did:'1xS9ypV4Mu30wCjydm6IwD7GCKDcksCf1'},
    {name:'Weights Card',file:'weights_card.png',type:'image',cat:'Gym Spotlights',did:'10twUd-K696v5eadqGqtitSUWIt420PE-'},
    {name:'Yoga Card',file:'yoga_card.png',type:'image',cat:'Gym Spotlights',did:'1FxBq4glKfB5GNg6gjcAlZkja02NwUTby'},
    // — Hero Videos —
    {name:'01 Gym Entry Vertical',file:'01_gym_entry_vertical.mp4',type:'video',cat:'Hero Videos',did:'18jbjZeDDv7B7jhnNctn9IvxrZM-5lP4l'},
    {name:'02 Phone Tap Vertical',file:'02_phone_tap_vertical.mp4',type:'video',cat:'Hero Videos',did:'1T49IUEJ_UNnKxBvrRAdMZPfHnYR4V3AB'},
    {name:'03 Workout Montage Horizontal',file:'03_workout_montage_horizontal.mp4',type:'video',cat:'Hero Videos',did:'1DO0PMxd_0P17t32a8FBiRExVtaP1ryTL'},
    // — Influencer Clips —
    {name:'S01 Huberman',file:'S01_Huberman.mp4',type:'video',cat:'Influencer Clips',did:'1XgbNCq9Ux2DGwLWxcxkQ4IJtlweYJh7C'},
    {name:'S06 Goggins',file:'S06_Goggins.mp4',type:'video',cat:'Influencer Clips',did:'1UyrNXS_1w16mqOwpUdyskfuSV4-fKZ27'},
    {name:'S11 Hormozi',file:'S11_Hormozi.mp4',type:'video',cat:'Influencer Clips',did:'1kYbL5WLUdM00AeUE9pllLH_zO3tGyPwv'},
    {name:'S17 Ksi',file:'S17_KSI.mp4',type:'video',cat:'Influencer Clips',did:'13TudgUqZ9VWqgcfdhPh9cvnjut_ksAJK'},
    {name:'S25 Genz',file:'S25_GenZ.mp4',type:'video',cat:'Influencer Clips',did:'1QLVxRiggc_XPok1IDs8VVPG_LAy5JVt8'},
    // — Instagram Posts —
    {name:'01 No Membership Hero',file:'01_no_membership_hero.png',type:'image',cat:'Instagram Posts',did:'1CIAML2llbelgEmMFphJTNXF_Gmj7tpM1'},
    {name:'02 How It Works',file:'02_how_it_works.png',type:'image',cat:'Instagram Posts',did:'1a-lVLQJ1P3z39MGNKQ6qE8KXP8qpY4FZ'},
    {name:'03 Any Gym Any Time',file:'03_any_gym_any_time.png',type:'image',cat:'Instagram Posts',did:'1xQ9rHHhEd5QWIyjUEDJwsg4JCxOyCg9i'},
    {name:'04 Earn With Scangym',file:'04_earn_with_scangym.png',type:'image',cat:'Instagram Posts',did:'1hgmAQu0oxIQKRu_GZF5m6sQiLxwPYKC0'},
    {name:'05 Founder Quote',file:'05_founder_quote.png',type:'image',cat:'Instagram Posts',did:'1iUUuBa-_fm5cpbMQe7vDO9kWYasnjZzK'},
    {name:'06 Vs Membership',file:'06_vs_membership.png',type:'image',cat:'Instagram Posts',did:'1GoNSpAFjrAG_Iu37msrgToPMNYv7nh_Y'},
    {name:'07 Testimonial Template',file:'07_testimonial_template.png',type:'image',cat:'Instagram Posts',did:'1UUElJn9SwD5qQoslaGQtcw8VYCB3GElS'},
    {name:'08 Gym Types Carousel',file:'08_gym_types_carousel.png',type:'image',cat:'Instagram Posts',did:'1reC786TrI9sG_AI_JnNnCTVADt2DVi9X'},
    // — Instagram Stories —
    {name:'02 Download App',file:'02_download_app.png',type:'image',cat:'Instagram Stories',did:'1kypMUkEf4snJ4cKbqsCvjg_ry9iKDqGh'},
    {name:'04 Before After',file:'04_before_after.png',type:'image',cat:'Instagram Stories',did:'1fDV-vyp7coyeMoJYmZgD4r4vJJTTaB1O'},
    // — Lifestyle AI —
    {name:'Busy Professional',file:'busy_professional.png',type:'image',cat:'Lifestyle AI',did:'17UAah6F6zuTPlTNO9pvIpsFAdMCjgd38'},
    {name:'Early Bird',file:'early_bird.png',type:'image',cat:'Lifestyle AI',did:'1Oj2kcRC-OLswfze-Tes3QErD-9TQG2sb'},
    {name:'Gym Hopper',file:'gym_hopper.png',type:'image',cat:'Lifestyle AI',did:'1uDVEHX0paIt6jzrLH46KQxPhRVU4DPN5'},
    {name:'Night Owl',file:'night_owl.png',type:'image',cat:'Lifestyle AI',did:'1kZ6G_uFhfMTajbauSRCmgLGKhIx-Xi3k'},
    {name:'Student Budget',file:'student_budget.png',type:'image',cat:'Lifestyle AI',did:'1r9jS6yyA32n4vbe79pGoapKWqgI7sX_6'},
    {name:'Traveller',file:'traveller.png',type:'image',cat:'Lifestyle AI',did:'1T9cc2npmBmLDctaC3ydUEgGJGQ8bMGwf'},
    // — Memes —
    {name:'Meme 01',file:'meme_01.png',type:'image',cat:'Memes',did:'1vXOWx1LDcg9hKYABODMPPksP3uf2_897'},
    {name:'Meme 02',file:'meme_02.png',type:'image',cat:'Memes',did:'1paoyKS_hlq4KOsHFDn0XBDF08QYwnjzK'},
    {name:'Meme 03',file:'meme_03.png',type:'image',cat:'Memes',did:'1PNOIdqD0RdFvwST6fQEkwtbcjMOKD5Ry'},
    {name:'Meme 04',file:'meme_04.png',type:'image',cat:'Memes',did:'169UJrB6ccNp2Ex4jdv-ZFKuvASPyqgDQ'},
    {name:'Meme 05',file:'meme_05.png',type:'image',cat:'Memes',did:'1qja-gqN0X0WnPL0Ft2AURYPpDvktzWex'},
    {name:'Meme 06',file:'meme_06.png',type:'image',cat:'Memes',did:'1qeXOT2CTDjsQak0vscbiXedPpPgle9kb'},
    {name:'Meme 07',file:'meme_07.png',type:'image',cat:'Memes',did:'11Cu_Ts7XTTaCmY0BnxhqB7xAci-Mf4cO'},
    {name:'Meme 08',file:'meme_08.png',type:'image',cat:'Memes',did:'14mTlnX7EXefl-oHTx9ylArWE5jjSOY1P'},
    {name:'Meme 09',file:'meme_09.png',type:'image',cat:'Memes',did:'1uRG0fylJqBAOzUwANg0NlOUpcxSakBqo'},
    {name:'Meme 10',file:'meme_10.png',type:'image',cat:'Memes',did:'1GdUPkTqV4ZW8nvjRrz3Mztuof9QtAdLR'},
    // — Price Comparison Vids —
    {name:'Vs Anytime Fitness',file:'vs_anytime_fitness.mp4',type:'video',cat:'Price Comparison Vids',did:'1XXQCzdLKRZEVosHajm9Rz_SJiVkR7iy4'},
    {name:'Vs David Lloyd',file:'vs_david_lloyd.mp4',type:'video',cat:'Price Comparison Vids',did:'15G66jW8V8zUw5-U-3qyYixWXnsGQjUg3'},
    {name:'Vs Fitness First',file:'vs_fitness_first.mp4',type:'video',cat:'Price Comparison Vids',did:'1jVzGetv483zUhuUhLShOkV4jTL8x7-kk'},
    {name:'Vs Jd Gyms',file:'vs_jd_gyms.mp4',type:'video',cat:'Price Comparison Vids',did:'1PGrx6EZw1CGX79y3iSNhmgotWpDlfaD2'},
    {name:'Vs Nuffield Health',file:'vs_nuffield_health.mp4',type:'video',cat:'Price Comparison Vids',did:'19DMkUDMtBhR1xbsOn8uxrSTlxihHOvg-'},
    {name:'Vs Puregym',file:'vs_puregym.mp4',type:'video',cat:'Price Comparison Vids',did:'1wRzENroo-sjiMOllL4dgS5N7HOwwjWDP'},
    {name:'Vs The Gym Group',file:'vs_the_gym_group.mp4',type:'video',cat:'Price Comparison Vids',did:'1BLI5vpteZqH6rSi9Ec9Gvka5dzZuP_Yr'},
    {name:'Vs Virgin Active',file:'vs_virgin_active.mp4',type:'video',cat:'Price Comparison Vids',did:'1S-zKCKK4z7f0Gvi16EgLEm_QxEs9x0cf'},
    // — Price Comparisons —
    {name:'Anytime Fitness Vs',file:'anytime_fitness_vs.png',type:'image',cat:'Price Comparisons',did:'1_bZg8Ob9FcMxXD2Nt1JyEl9jSnMg2Ru-'},
    {name:'David Lloyd Vs',file:'david_lloyd_vs.png',type:'image',cat:'Price Comparisons',did:'1F7h5i5tDUpyGtB5MEe_PCdVyvUOs4c2p'},
    {name:'Fitness First Vs',file:'fitness_first_vs.png',type:'image',cat:'Price Comparisons',did:'17tG1rdKdaH61RNzCcam2wsvEy-HFThj4'},
    {name:'Jd Gyms Vs',file:'jd_gyms_vs.png',type:'image',cat:'Price Comparisons',did:'1ug-Xi5tx_GX8OjgLCva24tOtfgxCRiHU'},
    {name:'Nuffield Health Vs',file:'nuffield_health_vs.png',type:'image',cat:'Price Comparisons',did:'11xdCmzVRwVR8c4Aut4Co7cefQ7ulZrq8'},
    {name:'Puregym Vs',file:'puregym_vs.png',type:'image',cat:'Price Comparisons',did:'1194iA8H0PBoLTQ7LvIeaOeAuV_W7rykP'},
    {name:'The Gym Group Vs',file:'the_gym_group_vs.png',type:'image',cat:'Price Comparisons',did:'1wbQgw3WCwnM9t-j6bk-9UeAm_7x3A54g'},
    {name:'Virgin Active Vs',file:'virgin_active_vs.png',type:'image',cat:'Price Comparisons',did:'1O5le2pIn0W2GaBxukZ3CpqbZ7Gun0vV1'},
    // — Product Features —
    {name:'Scangym Cmo Howitworks 3Step',file:'ScanGym-CMO-HowItWorks-3Step.webp',type:'image',cat:'Product Features',did:'14C8hXHN_a9MR-8oo5HuO35xNUWhnNSXL'},
    {name:'App Mockup',file:'app_mockup.png',type:'image',cat:'Product Features',did:'1rMbo1qvZwpdP2G9u5uaABI7TQ6rdByd5'},
    {name:'Map Pins',file:'map_pins.png',type:'image',cat:'Product Features',did:'1pVL3NPYYcGXydgRT8mYF34sbGQxh1fHA'},
    {name:'Price Comparison',file:'price_comparison.png',type:'image',cat:'Product Features',did:'1rdr-6d5LM_pWyWDFcIf9V5cEoSFjvBIu'},
    {name:'Qr Scan',file:'qr_scan.png',type:'image',cat:'Product Features',did:'1y9rZ2raI8W6jom2mE1b_nIjwLALRUm-H'},
    // — Quotes & Stats —
    {name:'Quote 01',file:'quote_01.png',type:'image',cat:'Quotes & Stats',did:'1dz1cnlzRSs5Rb73xu_LaSerqNOrLiIYx'},
    {name:'Quote 02',file:'quote_02.png',type:'image',cat:'Quotes & Stats',did:'1OozAhNjZqh8Sh2MZYWzXHodiDhxbsK1u'},
    {name:'Quote 03',file:'quote_03.png',type:'image',cat:'Quotes & Stats',did:'1XvIPTEIW1Z-TqJpOKQ9EQj5LlO6V5wUM'},
    {name:'Quote 04',file:'quote_04.png',type:'image',cat:'Quotes & Stats',did:'1GG1bjVdbQ6TmI3czA8d_pwSnadx65cjB'},
    {name:'Quote 05',file:'quote_05.png',type:'image',cat:'Quotes & Stats',did:'1D7M8CxPEUpP-2joZflypFZ9e2mrwul-S'},
    {name:'Quote 06',file:'quote_06.png',type:'image',cat:'Quotes & Stats',did:'1ey7y5mWqZCTOS3Io51UOx0Gxt1KLQ-YP'},
    {name:'Quote 07',file:'quote_07.png',type:'image',cat:'Quotes & Stats',did:'1KyVKxu5fNM32xeT8Lyv6DyupRTun4hus'},
    {name:'Quote 08',file:'quote_08.png',type:'image',cat:'Quotes & Stats',did:'1LmWxrUzapxXovUHrNUumsJoqZNo6_5-k'},
    {name:'Quote 09',file:'quote_09.png',type:'image',cat:'Quotes & Stats',did:'1n5o_XQRjnyLxL-JOQoNq1tEAgYD92aS2'},
    {name:'Quote 10',file:'quote_10.png',type:'image',cat:'Quotes & Stats',did:'1bYZGrq88k3ZGPCPa_yn8g684AiaJXLXK'},
    {name:'Quote 11',file:'quote_11.png',type:'image',cat:'Quotes & Stats',did:'1cyK0Lnv6u7fJL3H7YnTrBzzzMWiA427M'},
    {name:'Quote 12',file:'quote_12.png',type:'image',cat:'Quotes & Stats',did:'11b_-vLgpE13rxuKYapCGQVs-eibxfSzE'},
    {name:'Stat 01',file:'stat_01.png',type:'image',cat:'Quotes & Stats',did:'1ce9FR1UGFgj65yktFxz1ZNGWi3RfihVE'},
    {name:'Stat 02',file:'stat_02.png',type:'image',cat:'Quotes & Stats',did:'1g7d7lujkxnwoMv6tlTUS5koyHQdLEV4W'},
    {name:'Stat 03',file:'stat_03.png',type:'image',cat:'Quotes & Stats',did:'1jGyLHdK-avVop9TQ33uYJKcjhPAWr7MZ'},
    {name:'Stat 04',file:'stat_04.png',type:'image',cat:'Quotes & Stats',did:'1_qwX5cprOepTXVDL-7FHKHchw_UAke_z'},
    {name:'Stat 05',file:'stat_05.png',type:'image',cat:'Quotes & Stats',did:'1gM4J_eLGF8SY20X84HNUMNzieTA8p3xY'},
    {name:'Stat 06',file:'stat_06.png',type:'image',cat:'Quotes & Stats',did:'1yLKDE-xxAT0oD2dItdyMonC2EqNkjga8'},
    {name:'Stat 07',file:'stat_07.png',type:'image',cat:'Quotes & Stats',did:'1yBiIcQUT6XD3fcJ3tgFISR2xGYLz54Tm'},
    {name:'Stat 08',file:'stat_08.png',type:'image',cat:'Quotes & Stats',did:'1qUFVH_guP7gfvxcKlTSYOwnnnZK2DDs7'},
    {name:'Stat 09',file:'stat_09.png',type:'image',cat:'Quotes & Stats',did:'1nWaJPRd19r5KQPG90utsKQ8Wl-l2PTrB'},
    {name:'Stat 10',file:'stat_10.png',type:'image',cat:'Quotes & Stats',did:'1ty_c4phma1nD52ZAl4NSTBGYAztgV0om'},
    {name:'Testimonial 01',file:'testimonial_01.png',type:'image',cat:'Quotes & Stats',did:'1vE-rq1R0rQr1VarP-uQUaRvGMm2te53S'},
    {name:'Testimonial 02',file:'testimonial_02.png',type:'image',cat:'Quotes & Stats',did:'1cA3WqcXmQ8oq4onciZKi8DDNBcLePKFt'},
    {name:'Testimonial 03',file:'testimonial_03.png',type:'image',cat:'Quotes & Stats',did:'1x1HyDzLq5CE39RBN8I_rTqRSRDjUnIQW'},
    {name:'Testimonial 04',file:'testimonial_04.png',type:'image',cat:'Quotes & Stats',did:'1ng3Hh5W0BIZIpnMg6Pw-tUGCBaVYSVpI'},
    {name:'Testimonial 05',file:'testimonial_05.png',type:'image',cat:'Quotes & Stats',did:'1tGsClcrvVBI1v7meiD23mU9OlV--AVbu'},
    {name:'Testimonial 06',file:'testimonial_06.png',type:'image',cat:'Quotes & Stats',did:'1D3WfXeVDFiTU2AMPDrVUJ8lsn36GRILk'},
    {name:'Testimonial 07',file:'testimonial_07.png',type:'image',cat:'Quotes & Stats',did:'1zd7ioPqfTzj4ukS6_vuU3JruPXRAcJ9E'},
    {name:'Testimonial 08',file:'testimonial_08.png',type:'image',cat:'Quotes & Stats',did:'1z1QuxHCpNQa1OhZ_YX6WM_f94KUhRJff'},
    {name:'Vs 01',file:'vs_01.png',type:'image',cat:'Quotes & Stats',did:'1cFnyu_qeb_tWHwSi7GfwRJENZUpbcXdZ'},
    {name:'Vs 02',file:'vs_02.png',type:'image',cat:'Quotes & Stats',did:'1UVpdPWtnpbXuif2O__YhqiTBZ8Zv7YTz'},
    {name:'Vs 03',file:'vs_03.png',type:'image',cat:'Quotes & Stats',did:'1ep1XtUQ6IeMxDNozEpBinVK2NXBIn2qG'},
    // — Ready-to-Post —
    {name:'Citydiscovery Birmingham H0',file:'CityDiscovery_Birmingham_h0.mp4',type:'video',cat:'Ready-to-Post',did:'1TYDWdC-AO5g5RrETv1rI1VMcaGElNo6y'},
    {name:'Citydiscovery Birmingham H1',file:'CityDiscovery_Birmingham_h1.mp4',type:'video',cat:'Ready-to-Post',did:'1S2q26MbZ4V2MjMlA0WfWvPj_OwDH9gyL'},
    {name:'Citydiscovery Birmingham H2',file:'CityDiscovery_Birmingham_h2.mp4',type:'video',cat:'Ready-to-Post',did:'1xIj3hF-tjVtqGOfbvQrp88Vs3tGR0Rrd'},
    {name:'Citydiscovery Bolton H0',file:'CityDiscovery_Bolton_h0.mp4',type:'video',cat:'Ready-to-Post',did:'1PCZ01I_aPbOU_VjBpkG9Jggr93k6Zc9b'},
    {name:'Citydiscovery Bolton H1',file:'CityDiscovery_Bolton_h1.mp4',type:'video',cat:'Ready-to-Post',did:'1pNhWuorJf49x_4d3-VOHZHZy0uVLKJoh'},
    {name:'Citydiscovery Bolton H2',file:'CityDiscovery_Bolton_h2.mp4',type:'video',cat:'Ready-to-Post',did:'19gsr4rJpY2_f-aIymso_jKR_UFmhX-Cy'},
    {name:'Creatorearnings Birmingham H0',file:'CreatorEarnings_Birmingham_h0.mp4',type:'video',cat:'Ready-to-Post',did:'1nXziWa431cadQhckeerVCQWJrXpGwYkm'},
    {name:'Creatorearnings Birmingham H1',file:'CreatorEarnings_Birmingham_h1.mp4',type:'video',cat:'Ready-to-Post',did:'1KjAVfnr78mYOZJ83qgu8OqKuHERi8XUh'},
    {name:'Creatorearnings Birmingham H2',file:'CreatorEarnings_Birmingham_h2.mp4',type:'video',cat:'Ready-to-Post',did:'18m9fPHQynrqBbSNers6iUpeF0yD7ahBt'},
    {name:'Creatorearnings Bolton H0',file:'CreatorEarnings_Bolton_h0.mp4',type:'video',cat:'Ready-to-Post',did:'14bud3irhtBOW-htKjmziImga_zkFbCu6'},
    {name:'Creatorearnings Bolton H1',file:'CreatorEarnings_Bolton_h1.mp4',type:'video',cat:'Ready-to-Post',did:'1Nu-hkhIR1DsboTNOtvkmr-4x_sIw1bOX'},
    {name:'Creatorearnings Bolton H2',file:'CreatorEarnings_Bolton_h2.mp4',type:'video',cat:'Ready-to-Post',did:'1Ce5r-cTvyBr-tht1FLjNWhSicrzueE6z'},
    {name:'Dontjoinagym Birmingham Gbp10',file:'DontJoinAGym_Birmingham_GBP10.mp4',type:'video',cat:'Ready-to-Post',did:'1a3HlIpokiBChBB9jpN4Ie6VU-5vHE0P3'},
    {name:'Dontjoinagym Birmingham Gbp5',file:'DontJoinAGym_Birmingham_GBP5.mp4',type:'video',cat:'Ready-to-Post',did:'1ITxbJc9w6R4oF_87UNh3xvxbyoyiE5sy'},
    {name:'Dontjoinagym Birmingham Gbp7',file:'DontJoinAGym_Birmingham_GBP7.mp4',type:'video',cat:'Ready-to-Post',did:'1FTXykzJFSbzv7WQAgsCNNL2THNunARLk'},
    {name:'Dontjoinagym Bolton Gbp10',file:'DontJoinAGym_Bolton_GBP10.mp4',type:'video',cat:'Ready-to-Post',did:'1N00LuuVIbWFtQsTckQClCeiYunfXWIwx'},
    {name:'Dontjoinagym Bolton Gbp5',file:'DontJoinAGym_Bolton_GBP5.mp4',type:'video',cat:'Ready-to-Post',did:'1VwPMqVF5YCmtACOSlyV4eCLdjB9iLhC2'},
    {name:'Dontjoinagym Bolton Gbp7',file:'DontJoinAGym_Bolton_GBP7.mp4',type:'video',cat:'Ready-to-Post',did:'1EgSzjN6W3DQ-2UZhrEnOhYlQnqUOfis5'},
    {name:'Howitworks Birmingham H0',file:'HowItWorks_Birmingham_h0.mp4',type:'video',cat:'Ready-to-Post',did:'15LxZWnKz53kmxi3SfCi3smKTfOKCteXM'},
    {name:'Howitworks Birmingham H1',file:'HowItWorks_Birmingham_h1.mp4',type:'video',cat:'Ready-to-Post',did:'1j4lB0ZXfP_2ycCx6VYJgT1ixoMg_hlhl'},
    {name:'Howitworks Birmingham H2',file:'HowItWorks_Birmingham_h2.mp4',type:'video',cat:'Ready-to-Post',did:'1vm3Rk-YgkQ2gFOLngVe73g4bupSOuGDq'},
    {name:'Pricecompare Birmingham H0',file:'PriceCompare_Birmingham_h0.mp4',type:'video',cat:'Ready-to-Post',did:'1hcDYJt2N-TLCsEbzmtX-2M1O4CpUsgRU'},
    {name:'Pricecompare Birmingham H1',file:'PriceCompare_Birmingham_h1.mp4',type:'video',cat:'Ready-to-Post',did:'14sPHzXnJJNpLDmwcHYnJ0tRlh_lyDK4r'},
    {name:'Pricecompare Birmingham H2',file:'PriceCompare_Birmingham_h2.mp4',type:'video',cat:'Ready-to-Post',did:'1MSpCXQy7Haj63Gu1fSkTJ4qAYeda5dRr'},
    // — Seasonal Themes —
    {name:'Back To Uni',file:'back_to_uni.png',type:'image',cat:'Seasonal Themes',did:'16UoOfESNjWWpKXVomvxlWIQ743c_-vuy'},
    {name:'Black Friday',file:'black_friday.png',type:'image',cat:'Seasonal Themes',did:'1af60qhm8_gc5_KHyPMiAnmXnBXZlip70'},
    {name:'Monday Motivation',file:'monday_motivation.png',type:'image',cat:'Seasonal Themes',did:'1Abf-n7SZt6eF4Sc5OB1NLG7w3hNTMbrm'},
    {name:'New Year Resolution',file:'new_year_resolution.png',type:'image',cat:'Seasonal Themes',did:'1RgDkHLUBcPE8-STiGnsXvQ3p90P4MCMi'},
    {name:'Summer Body',file:'summer_body.png',type:'image',cat:'Seasonal Themes',did:'1D0xP-f3NGskYRvSWKAkWTKJsx0QSwqWv'},
    {name:'Valentines',file:'valentines.png',type:'image',cat:'Seasonal Themes',did:'1gFyWZiG-sSqHvwqW3FxuZGavlbrZvxio'},
    // — TikTok-Reels AI —
    {name:'Reel Morning Routine',file:'reel_morning_routine.mp4',type:'video',cat:'TikTok-Reels AI',did:'1hJcBQ8AQr4LC0225XCCv7E3015lsI0rs'},
    {name:'Tiktok 5 Pound',file:'tiktok_5_pound.mp4',type:'video',cat:'TikTok-Reels AI',did:'10YquVXQam1pkUWSibMr3VpK4rtUfadgX'},
    {name:'Tiktok Affiliate Earn',file:'tiktok_affiliate_earn.mp4',type:'video',cat:'TikTok-Reels AI',did:'15CPW0MjnqxggPGSiwe85YFXU0182hUri'},
    {name:'Tiktok Any Gym',file:'tiktok_any_gym.mp4',type:'video',cat:'TikTok-Reels AI',did:'1lmvm3XdCNubu2863fR3Mobc8OldO_0P2'},
    {name:'Tiktok Gym Hopping',file:'tiktok_gym_hopping.mp4',type:'video',cat:'TikTok-Reels AI',did:'1E_i7-F7Q4r2D675yS7xuBsia0CJI0abd'},
    {name:'Tiktok Membership Rip',file:'tiktok_membership_rip.mp4',type:'video',cat:'TikTok-Reels AI',did:'1SCMTTxaVfjuZYYoMNGcjbVAuJ3gNcd86'},
    {name:'Tiktok Student Hack',file:'tiktok_student_hack.mp4',type:'video',cat:'TikTok-Reels AI',did:'1UQ4GU9iGVjE6o4U9xJ5xwNWXFvcVexjC'},
    {name:'Tiktok Walk In',file:'tiktok_walk_in.mp4',type:'video',cat:'TikTok-Reels AI',did:'159Pw9sES2q7a4Q-e8jf7A8Zv8g8ah2ts'},
    // — UGC Videos —
    {name:'02152304Fbea45A4A5396C23Ba827Be9 B860C0646994925E9',file:'02152304fbea45a4a5396c23ba827be9-b860c0646994925e9c89b98a150c16b2-ld.mp4',type:'video',cat:'UGC Videos',did:'1R6lz_Quk2D_Tb2f3thfXXHl_Ukq5K87p'},
    {name:'1',file:'1.mp4',type:'video',cat:'UGC Videos',did:'1PIvkq78ofHIowoxPx0s4liomXenDqM4g'},
    {name:'1.Mp4 30B9911B2A2B71Efbfc94531859C0102',file:'1.mp4_30b9911b2a2b71efbfc94531859c0102.mp4',type:'video',cat:'UGC Videos',did:'1kdbzLcZS2zqiY7_lL56i3Y-jtJzG0iXM'},
    {name:'1.Mp4 40636Cc8D47671Eeba924531958D0102',file:'1.mp4_40636cc8d47671eeba924531958d0102.mp4',type:'video',cat:'UGC Videos',did:'1zMewTxJtYrbvTwSpRj1YIO3z06op-H24'},
    {name:'1.Mp4 60A4A203Cb8A71Eeb5824531959C0102',file:'1.mp4_60a4a203cb8a71eeb5824531959c0102.mp4',type:'video',cat:'UGC Videos',did:'14wvhhd-5DFzWvoagnRXMKVXDvhzuPSmg'},
    {name:'1.Mp4 709D7460Cae971Eeae8E4531958C0102',file:'1.mp4_709d7460cae971eeae8e4531958c0102.mp4',type:'video',cat:'UGC Videos',did:'1WC91--h3hx1-p69L5U9i7xf7zESwv2lx'},
    {name:'1.Mp4 80B164782A2B71Efbfc94531859C0102',file:'1.mp4_80b164782a2b71efbfc94531859c0102.mp4',type:'video',cat:'UGC Videos',did:'1GmS3mdPUR4refjg2PoEX5tcfUse9sxBE'},
    {name:'1.Mp4 901Fcb4Ee45271Eebfc34531959D0102',file:'1.mp4_901fcb4ee45271eebfc34531959d0102.mp4',type:'video',cat:'UGC Videos',did:'1AMUxnBolu7Ao0iKKbZbVxL1MYCiokvms'},
    {name:'1.Mp4 A00Cec70Caea71Eebfc45017F1F80102',file:'1.mp4_a00cec70caea71eebfc45017f1f80102.mp4',type:'video',cat:'UGC Videos',did:'1SPFLgI3c8trMGFODFFtoF_FofjMBwzRI'},
    {name:'1.Mp4 A06Ec86Fd47671Eea8645017F0E80102',file:'1.mp4_a06ec86fd47671eea8645017f0e80102.mp4',type:'video',cat:'UGC Videos',did:'1mpiH7CGWzFyTwNoLTBc9RrZOaAlAX826'},
    {name:'1.Mp4 B05D6Aabe45271Eebc5C5420848D0102',file:'1.mp4_b05d6aabe45271eebc5c5420848d0102.mp4',type:'video',cat:'UGC Videos',did:'1dxlPxNrUPby_v3RazYkbTsQQ22Z0P8f9'},
    {name:'1.Mp4 C0B80D70Cb2571Eebfc35017F0E80102',file:'1.mp4_c0b80d70cb2571eebfc35017f0e80102.mp4',type:'video',cat:'UGC Videos',did:'1IrEd5fdFwiHk8ArfeRmU87o3hhhWGVf-'},
    {name:'10 Mubarak Pvc Sp100 S50 Sb75 V3 Processed',file:'10_Mubarak_pvc_sp100_s50_sb75_v3_PROCESSED.mp4',type:'video',cat:'UGC Videos',did:'1SHxFWf7S9HziPwsxBwqKtCs6eJ10A9TD'},
    {name:'12',file:'12.mp4',type:'video',cat:'UGC Videos',did:'1OFt8q7V5i2hkcNviTRK0Cmvd2EfMERjO'},
    {name:'1 0Ab3D480673171Ee80116732B68E0102',file:'1_0ab3d480673171ee80116732b68e0102.mp4',type:'video',cat:'UGC Videos',did:'1nvKUEmKLD-DHz8etTTZOmVKfJCEDJA8A'},
    {name:'1 122B9Ca068C871Ee80170764A3Fd0102',file:'1_122b9ca068c871ee80170764a3fd0102.mp4',type:'video',cat:'UGC Videos',did:'1_-T1SE-LriMCyrp2wcyrDMg-HuLiaW1-'},
    {name:'1 1Edd9Fa0Ee1871Edbffe0764A0Ec0102',file:'1_1edd9fa0ee1871edbffe0764a0ec0102.mp4',type:'video',cat:'UGC Videos',did:'1eSdP-0ldfsShjnXH1i2WBp1kyZ-ExxRJ'},
    {name:'1 22E2Dec0Ee1971Ed80540764A0Fd0102',file:'1_22e2dec0ee1971ed80540764a0fd0102.mp4',type:'video',cat:'UGC Videos',did:'1OYMGsCouBRMcaHaI-6joanWzbmetqa39'},
    {name:'1 2Cb095E0673271Ee80116732B68E0102',file:'1_2cb095e0673271ee80116732b68e0102.mp4',type:'video',cat:'UGC Videos',did:'1u0kq5WNW4jqSJ_55GhxMiwv0E6l7uBXh'},
    {name:'1 3Cd66C50Ee1671Ed80546633B79F0102',file:'1_3cd66c50ee1671ed80546633b79f0102.mp4',type:'video',cat:'UGC Videos',did:'1vqIrcxEM8GOScnyMc9LLGhCAWSSuQDYf'},
    {name:'1 3Dcff1D068C871Ee80406723B78E0102',file:'1_3dcff1d068c871ee80406723b78e0102.mp4',type:'video',cat:'UGC Videos',did:'1RTEz3IoDkdI07nHTHk4w6I8DTFBnS_iW'},
    {name:'1 43392Bb0673271Ee988F5017F0E80102',file:'1_43392bb0673271ee988f5017f0e80102.mp4',type:'video',cat:'UGC Videos',did:'1vu-4OBAps2pmHk0vVekmY_cht5fAAppX'},
    {name:'1 47Fefe80B72571Edbfd10764B3Ec0102',file:'1_47fefe80b72571edbfd10764b3ec0102.mp4',type:'video',cat:'UGC Videos',did:'1NybWh1NzVyGot7iCOKlecJe3ZbCNDvsb'},
    {name:'1 570B24C0Ee1771Edbffa6732B68E0102',file:'1_570b24c0ee1771edbffa6732b68e0102.mp4',type:'video',cat:'UGC Videos',did:'1GPrpvm42w9prh7LGO_TW6O5DKFrY8ocp'},
    {name:'1 57Df3310Ee1671Edbfec0764A3Fd0102',file:'1_57df3310ee1671edbfec0764a3fd0102.mp4',type:'video',cat:'UGC Videos',did:'1BMJUy8nu8gwcLT6rXik36ZIa0_GUMMKn'},
    {name:'1 60Be1850Ee1871Ed80540764A0Fd0102',file:'1_60be1850ee1871ed80540764a0fd0102.mp4',type:'video',cat:'UGC Videos',did:'1ENqICIOCQ4EF_ttZ5Y2H8vr3VvePovSS'},
    {name:'1 6972B220932971Ed805D6633B79F0102',file:'1_6972b220932971ed805d6633b79f0102.mp4',type:'video',cat:'UGC Videos',did:'1pAosRNUhCZSHsVkH_wzZrCCaQnRbDFAc'},
    {name:'1 6C8Ac4A0B72571Edbffe0764A3Fc0102',file:'1_6c8ac4a0b72571edbffe0764a3fc0102.mp4',type:'video',cat:'UGC Videos',did:'1R7LKe2lNYEmq0IUYp4DvArqzEADCBHZ3'},
    {name:'1 80F9Fcc8Abb071Eea4386723A78F0102',file:'1_80f9fcc8abb071eea4386723a78f0102.mp4',type:'video',cat:'UGC Videos',did:'1TIi1ai6tqhQn3s2wb66xUYf7Spkdkifk'},
    {name:'1 85F19020Ee1871Edbfed0764A3Fd0102',file:'1_85f19020ee1871edbfed0764a3fd0102.mp4',type:'video',cat:'UGC Videos',did:'1xEuGfLnc9apmzNy0t_VedZaN4RRiYmd7'},
    {name:'1 86A94Ec0Ee1571Edbffe0764A0Ec0102',file:'1_86a94ec0ee1571edbffe0764a0ec0102.mp4',type:'video',cat:'UGC Videos',did:'1cJNPL2qkcGHEex3lqfO-xb_kYnsx4RPV'},
    {name:'1 9D386Ce0Ee1871Ed80546633B79F0102',file:'1_9d386ce0ee1871ed80546633b79f0102.mp4',type:'video',cat:'UGC Videos',did:'1X-Veil57e5JdB-e1DQtOSpANMXl5cdXD'},
    {name:'1 9Ea06B30Bbed71Ed80580674A2Ce0102',file:'1_9ea06b30bbed71ed80580674a2ce0102.mp4',type:'video',cat:'UGC Videos',did:'1XcqNI114eh25zsExezq6ave0X563KHQY'},
    {name:'1 A001E1E0C40F71Eebfdb5017F1E80102',file:'1_a001e1e0c40f71eebfdb5017f1e80102.mp4',type:'video',cat:'UGC Videos',did:'1M6gbvAxoQSGuUYitm5cH7su3qkWet4g8'},
    {name:'1 A840Dda0Bbed71Edbfee6732B68F0102',file:'1_a840dda0bbed71edbfee6732b68f0102.mp4',type:'video',cat:'UGC Videos',did:'1QOL9xFU7QxVn-tSbScMlg0V1lh5ZIoXj'},
    {name:'1 B08F5220Ee1571Edb0910674A2Ce0102',file:'1_b08f5220ee1571edb0910674a2ce0102.mp4',type:'video',cat:'UGC Videos',did:'10B_vNNvSnUcg_Gc31NbuXfek2jpLK6I9'},
    {name:'1 B0E7Bfe8D12571Ee9Feb6732B68F0102',file:'1_b0e7bfe8d12571ee9feb6732b68f0102.mp4',type:'video',cat:'UGC Videos',did:'1WrbGbBe53qsYnnFgRZ-_KUgwhTtAkP0W'},
    // — Viral Videos —
    {name:'Faketweet V01',file:'FakeTweet_v01.mp4',type:'video',cat:'Viral Videos',did:'1YnD3lIKn0P8XgfAwLy4aR10nYa9VDEdy'},
    {name:'Faketweet V02',file:'FakeTweet_v02.mp4',type:'video',cat:'Viral Videos',did:'1IjRVSpF9ML_8lm7uhxHUlOE5XSC4_HCO'},
    {name:'Faketweet V03',file:'FakeTweet_v03.mp4',type:'video',cat:'Viral Videos',did:'1OufSCzwJUrdBThD8fs9smoBmdS5kIxcX'},
    {name:'Faketweet V04',file:'FakeTweet_v04.mp4',type:'video',cat:'Viral Videos',did:'1l0e6_jWkTY4NHAQRMDIObGDsAOI3gLKK'},
    {name:'Faketweet V05',file:'FakeTweet_v05.mp4',type:'video',cat:'Viral Videos',did:'1hPSGIpwKIvNnOyzF1_a3RH-b-1RLSrN3'},
    {name:'Faketweet V06',file:'FakeTweet_v06.mp4',type:'video',cat:'Viral Videos',did:'12npQMp6NbcXGNRO5GxQRtlHzkpQF2qTI'},
    {name:'Faketweet V07',file:'FakeTweet_v07.mp4',type:'video',cat:'Viral Videos',did:'17iPqQh7lmAgbZ22QnkCNg7K4rYpKg1L8'},
    {name:'Faketweet V08',file:'FakeTweet_v08.mp4',type:'video',cat:'Viral Videos',did:'1M9c8GUYSxk9DK1vUqZf3YB17GFEh9zJG'},
    {name:'Faketweet V09',file:'FakeTweet_v09.mp4',type:'video',cat:'Viral Videos',did:'1Yg01Cb3cCpoF-UJDBVKBRZ-j8FTFCJlO'},
    {name:'Faketweet V10',file:'FakeTweet_v10.mp4',type:'video',cat:'Viral Videos',did:'1d9TDJmgzf0lFjwda7SlzXbrE1LjdNKxR'},
    {name:'Hottake V01',file:'HotTake_v01.mp4',type:'video',cat:'Viral Videos',did:'1h8BrDZNL3dsP9utFkYmiNPAdsFWFwzx3'},
    {name:'Hottake V02',file:'HotTake_v02.mp4',type:'video',cat:'Viral Videos',did:'1K6HWSwDEwXF9bN-XDRXEWWsmw9H7wBjY'},
    {name:'Hottake V03',file:'HotTake_v03.mp4',type:'video',cat:'Viral Videos',did:'1bem2DWMeUjB8n2eqekVp4l11Yt68pK7b'},
    {name:'Hottake V04',file:'HotTake_v04.mp4',type:'video',cat:'Viral Videos',did:'1i7_fklmSjadFModxFhkOVJamVYaEQ735'},
    {name:'Hottake V05',file:'HotTake_v05.mp4',type:'video',cat:'Viral Videos',did:'1C63mjzB19QxbbTx4pVTcc3n6FMe6nw1H'},
    {name:'Hottake V06',file:'HotTake_v06.mp4',type:'video',cat:'Viral Videos',did:'1Tm9hQop8xMpF13ge6JmW-GdbRBi9amJb'},
    {name:'Hottake V07',file:'HotTake_v07.mp4',type:'video',cat:'Viral Videos',did:'1dQc8tL8fCArSUAekX4NoOpi4E9BwluxG'},
    {name:'Hottake V08',file:'HotTake_v08.mp4',type:'video',cat:'Viral Videos',did:'1UUgh4KeD0CKxCTSl5JKKbUmo5sJVPImF'},
    {name:'Hottake V09',file:'HotTake_v09.mp4',type:'video',cat:'Viral Videos',did:'1OT63oaJx8oppyTZg-fN28FmgW1eCR4XR'},
    {name:'Hottake V10',file:'HotTake_v10.mp4',type:'video',cat:'Viral Videos',did:'197dgMX6mJikLRxsVGU-6P9A5iKkV8zqb'},
    {name:'Identityhook V01',file:'IdentityHook_v01.mp4',type:'video',cat:'Viral Videos',did:'1-6xtPyps-XdeCooEdIXWdd6RhvsZQfWY'},
    {name:'Identityhook V02',file:'IdentityHook_v02.mp4',type:'video',cat:'Viral Videos',did:'1mjUTU8cUjuAPpN-jtU3HkpgAkLCHqSfB'},
    {name:'Identityhook V03',file:'IdentityHook_v03.mp4',type:'video',cat:'Viral Videos',did:'1Lf_T_UNIlKCvWPp32LRSJhf7LLhklkiv'},
    {name:'Identityhook V04',file:'IdentityHook_v04.mp4',type:'video',cat:'Viral Videos',did:'1IIWF0gcFZt5oenOZxRBTEx73PgiMWeJZ'},
    {name:'Identityhook V05',file:'IdentityHook_v05.mp4',type:'video',cat:'Viral Videos',did:'1eh1ZWF9POqte9p_-xu1JSKZg2DzDil4X'},
    {name:'Identityhook V06',file:'IdentityHook_v06.mp4',type:'video',cat:'Viral Videos',did:'1ix2Ql6YJ_Lx9cbyEJHKJA8KkJ0ObzeFS'},
    // — YouTube AI —
    {name:'Yt Affiliate Explained',file:'yt_affiliate_explained.mp4',type:'video',cat:'YouTube AI',did:'13EgwbOI5Vfrks3Y2eRtUcYjBJfv_ErqM'},
    {name:'Yt Every Gym Tested',file:'yt_every_gym_tested.mp4',type:'video',cat:'YouTube AI',did:'1m4p5xpQY6DgRKemiRmJpgqCs4H6449GR'},
    {name:'Yt No Membership',file:'yt_no_membership.mp4',type:'video',cat:'YouTube AI',did:'1Y2CCTszoUFj0xcPNIx3FOb1iibZ-i81I'},
    {name:'Yt Price Reveal',file:'yt_price_reveal.mp4',type:'video',cat:'YouTube AI',did:'1HfNGiW4AOiXgOrAazy10OpaaZm2JjAO3'},
    // — YouTube Thumbs —
    {name:'01 Tried Every Gym',file:'01_tried_every_gym.png',type:'image',cat:'YouTube Thumbs',did:'1LBzDsjfyXMZ8D_YWF4pPrXGS0Pb8JLBK'},
    {name:'02 No Membership Hack',file:'02_no_membership_hack.png',type:'image',cat:'YouTube Thumbs',did:'1JPKNnCKebQUzLGwcvs0VK6CsJ1vNK6zq'},
    // — YouTube Thumbs AI —
    {name:'Yt 5 Pound Challenge',file:'yt_5_pound_challenge.png',type:'image',cat:'YouTube Thumbs AI',did:'1jHq8qV6641jp41-8yHO2awnwMfzqz3Am'},
    {name:'Yt Gym Hack',file:'yt_gym_hack.png',type:'image',cat:'YouTube Thumbs AI',did:'1W3QQC8dYK78MdtJM2q7N-HkiTgN2fOnQ'},
    {name:'Yt Membership Scam',file:'yt_membership_scam.png',type:'image',cat:'YouTube Thumbs AI',did:'1enwJAb4_ye61Qg3MD35yoRLyIl4CNwKo'},
    ];

  return`
  <div class="pt-8 min-h-full">

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  HERO — Aspirational headline + stats + dual CTA          -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="relative overflow-hidden px-4 py-20 md:py-28">
      <div class="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-orange-950/30"></div>
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand/10 via-transparent to-transparent"></div>
      <div class="relative max-w-6xl mx-auto text-center">
        <div class="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 rounded-full px-5 py-2 mb-8">
          <span class="text-2xl">💪</span>
          <span class="text-brand font-bold text-sm tracking-wider uppercase">ScanSquad Creator Program</span>
        </div>
        <h1 class="font-brand text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">
          Your Gym Content.<br><span class="text-brand">Your Earnings.</span>
        </h1>
        <p class="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-8">
          Join the ScanSquad — ScanGym's creator community. Share gyms you love, earn 25% commission on every booking, and train for free.
        </p>
        <div class="flex flex-wrap justify-center gap-6 md:gap-12 mb-10">
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white" data-counter data-target="25" data-suffix="%">0%</p><p class="text-slate-500 text-sm">Commission</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white" data-counter data-target="242" data-suffix="+">0+</p><p class="text-slate-500 text-sm">Ready-to-go Assets</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white">£5K<span class="text-brand">+</span></p><p class="text-slate-500 text-sm">Top Earnings/mo</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-brand">FREE</p><p class="text-slate-500 text-sm">Gym Sessions</p></div>
        </div>
        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button onclick="state.user?window._sg1ClickCreatorSignup():navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition text-lg shadow-lg shadow-brand/20 hover:shadow-brand/40">Join ScanSquad — It's Free</button>
          <a href="#fs-how" onclick="event.preventDefault();document.getElementById('fs-how').scrollIntoView({behavior:'smooth'})" class="text-slate-300 hover:text-white font-medium px-6 py-4 rounded-xl border border-slate-700 hover:border-slate-500 transition cursor-pointer">See How It Works ↓</a>
        </div>
        <p class="text-slate-600 text-sm mt-4">No minimum followers · No application · Start in 60 seconds</p>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  WHO IS THIS FOR — Persona cards (Shopify pattern)        -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900/50">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">Who's in ScanSquad?</h2>
        <p class="text-slate-400 text-center mb-12 max-w-xl mx-auto">Whether you have 100 followers or 100K — if you love gyms, this is for you.</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {title:'Fitness TikTokers',desc:'Share gym finds, workout clips, and booking walkthroughs with your followers.',icon:'📱',stat:'Avg £200-500/mo',img:'ScanGym-Asset1-Hero-Banner.webp'},
            {title:'Gym Bloggers',desc:'Write reviews, film gym tours, rate equipment — your audience books through your link.',icon:'✍️',stat:'Avg £150-400/mo',img:'ScanGym-Asset9-Gym-Review-Story.webp'},
            {title:'PTs & Coaches',desc:'Recommend gyms to clients. They book, you earn. Plus free sessions for yourself.',icon:'🏋️',stat:'Avg £300-800/mo',img:'ScanGym-Asset8-Comment-Bait.webp'},
            {title:'Students',desc:'Tight budget? Share ScanGym on campus socials and fund your own gym sessions.',icon:'🎓',stat:'Avg £50-200/mo',img:'ScanGym-Asset6-Viral-Hook.webp'},
          ].map(p=>`
            <div class="group bg-card rounded-2xl overflow-hidden border border-slate-700/50 hover:border-brand/30 transition-all duration-300 hover:-translate-y-1">
              <div class="h-40 bg-slate-800 overflow-hidden">
                <img src="${A}/thumbs/creator_assets/${p.img}" alt="${p.title}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" width="400" height="225" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\'flex items-center justify-center h-full text-5xl\'>${p.icon}</div>'">
              </div>
              <div class="p-5">
                <div class="flex items-center gap-2 mb-2"><span class="text-xl">${p.icon}</span><h3 class="text-white font-bold text-lg">${p.title}</h3></div>
                <p class="text-slate-400 text-sm mb-3">${p.desc}</p>
                <span class="inline-block bg-brand/10 text-brand text-xs font-bold px-3 py-1 rounded-full">${p.stat}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  HOW IT WORKS — 3 steps (universal pattern)               -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section id="fs-how" class="px-4 py-16">
      <div class="max-w-5xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">How ScanSquad Works</h2>
        <p class="text-slate-400 text-center mb-12">Three steps. Sixty seconds. Zero cost.</p>
        <div class="grid md:grid-cols-3 gap-8">
          ${[
            {step:'01',title:'Sign Up & Get Your Link',desc:'Create your free ScanSquad account. Instantly receive your personal referral page at <strong class="text-brand">scangym.com/r/yourname</strong>.',icon:'🔗'},
            {step:'02',title:'Share Gyms You Love',desc:'Post gym content, share your link, and use our <strong class="text-white">242+ ready-made assets</strong> — stories, reels, posts, videos. All free.',icon:'📤'},
            {step:'03',title:'Earn On Every Booking',desc:'When someone books through your link you earn <strong class="text-brand">25% commission</strong> (${sgCommissionRange()} per booking). Paid weekly. No caps.',icon:'💰'},
          ].map(s=>`
            <div class="bg-card rounded-2xl p-8 border border-slate-700/50 hover:border-brand/20 transition h-full">
              <div class="flex items-center gap-4 mb-4">
                <span class="text-4xl">${s.icon}</span>
                <span class="text-brand/20 font-brand text-6xl font-bold select-none">${s.step}</span>
              </div>
              <h3 class="text-white font-bold text-xl mb-3">${s.title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">${s.desc}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  EARNINGS CALCULATOR — Interactive slider (Shopify style)  -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900">
      <div class="max-w-5xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-12">Calculate Your Earnings</h2>
        <div class="grid md:grid-cols-2 gap-8 items-center">
          <div class="bg-card rounded-2xl p-8 border border-slate-700/50">
            <h3 class="text-white font-bold text-lg mb-2">Referrals per month</h3>
            <p class="text-slate-400 text-sm mb-6">Earn <strong class="text-brand">25% commission</strong> (${sgCommissionRange()}) per booking</p>
            <div class="flex items-center gap-4 mb-4">
              <span id="calc-val" class="bg-slate-800 text-white text-3xl font-bold px-6 py-3 rounded-xl min-w-[100px] text-center">10</span>
              <span class="text-slate-500">bookings</span>
            </div>
            <input type="range" id="calc-slider" min="1" max="200" value="10" class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand" oninput="document.getElementById('calc-val').textContent=this.value;const v=parseInt(this.value),hi=v*15;document.getElementById('calc-earn').innerHTML='Up to <span class=\'text-brand text-4xl md:text-5xl font-bold\'>£'+hi.toLocaleString()+'</span>';document.getElementById('calc-yr').textContent='£'+(v*10*12).toLocaleString()+' — £'+(hi*12).toLocaleString()+' per year';document.getElementById('calc-tier').textContent=v>=500?'\ud83c\udfc6 Legend':v>=100?'\ud83d\udc8e Elite':v>=25?'\ud83d\udd25 Hot Creator':v>=5?'\u26a1 Rising Star':'\ud83c\udf31 Starter';">
            <div class="flex justify-between text-slate-600 text-xs mt-2"><span>1</span><span>50</span><span>100</span><span>200</span></div>
            <div class="mt-6 pt-6 border-t border-slate-700">
              <p class="text-slate-500 text-xs mb-1">Estimated monthly earnings</p>
              <p id="calc-earn">Up to <span class="text-brand text-4xl md:text-5xl font-bold">£150</span></p>
              <p id="calc-yr" class="text-slate-500 text-sm mt-1">£1,200 — £1,800 per year</p>
              <p class="text-slate-600 text-xs mt-2">Your tier: <span id="calc-tier" class="text-white">\ud83c\udf31 Starter</span></p>
            </div>
          </div>
          <div class="text-center md:text-left space-y-6">
            <div class="bg-brand/10 border border-brand/20 rounded-2xl p-8">
              <h3 class="text-4xl md:text-5xl font-bold text-white mb-2">No commission<br>caps. <span class="text-brand">Ever.</span></h3>
              <p class="text-slate-400 mt-3">The more you share, the more you earn. Top ScanSquad creators earn £1,200-5,000+ per month.</p>
            </div>
            <button onclick="state.user?window._sg1ClickCreatorSignup():navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition text-lg w-full md:w-auto">Start Earning →</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    
    <!-- CREATOR TESTIMONIALS -->
    <section class="px-4 py-16 bg-slate-900">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">Creators Love ScanSquad</h2>
        <p class="text-slate-400 text-center mb-12">Real stories from real creators earning real money</p>
        <div class="grid md:grid-cols-3 gap-6">
          ${[
            {name:'Sarah K.',loc:'London',av:'\ud83e\uddd1\u200d\ud83d\udcbb',handle:'@sarahfitldn',fol:'12K',earn:'\u00a387/mo',q:'I share gym finds on my Instagram stories and the commissions just roll in. Easiest side income ever.'},
            {name:'James M.',loc:'Manchester',av:'\ud83d\udcaa',handle:'@jamesgymlife',fol:'34K',earn:'\u00a3340/mo',q:'ScanSquad pays for all my gym sessions and then some. The 242+ ready-made assets save me hours every week.'},
            {name:'Priya S.',loc:'Birmingham',av:'\u2b50',handle:'@priyawellness',fol:'8K',earn:'\u00a3156/mo',q:'Even with a smaller following, the conversion rate is incredible. People actually want affordable gym access.'}
          ].map(t=>`
            <div class="bg-card rounded-2xl p-6 border border-slate-700/50 hover:border-brand/30 transition-all">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 bg-brand/20 rounded-full flex items-center justify-center text-2xl">${t.av}</div>
                <div><p class="text-white font-bold">${t.name}</p><p class="text-slate-400 text-sm">${t.handle} \u00b7 ${t.fol} followers</p></div>
              </div>
              <p class="text-slate-300 text-sm leading-relaxed mb-4">"${t.q}"</p>
              <div class="flex items-center justify-between pt-4 border-t border-slate-700/50">
                <span class="text-slate-500 text-xs">\ud83d\udccd ${t.loc}</span>
                <span class="text-brand font-bold text-sm">${t.earn}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!--  TIER SYSTEM — 4 levels with real perks                    -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">Level Up Your Earnings</h2>
        <p class="text-slate-400 text-center mb-12">Four tiers. Real perks. The more you grow, the more you get.</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {tier:'Starter',req:'Just sign up',earnings:'\u00A350-150',icon:'\ud83c\udf31',col:'slate',perks:['25% commission','Personal referral link','242+ assets','Weekly payouts','Real-time dashboard'],quote:'Share gym finds on stories and earn commission on every booking.'},
            {tier:'Rising Star',req:'5+ bookings/mo',earnings:'\u00A3150-400',icon:'\u26a1',col:'brand',perks:['Everything in Starter','Priority support','Featured on leaderboard','Bonus challenges','Community access'],quote:'Build momentum with regular sharing and grow your audience.'},
            {tier:'Hot Creator',req:'25+ bookings/mo',earnings:'\u00A3400-800',icon:'\ud83d\udd25',col:'brand',perks:['Everything in Rising Star','Unlimited free sessions','\u00A325 monthly bonus','Co-branded content','Early feature access'],quote:'Consistent creators unlock free gym access and monthly bonuses.'},
            {tier:'Elite',req:'100+ bookings/mo',earnings:'\u00A3800-2,000',icon:'\ud83d\udc8e',col:'yellow',perks:['Everything in Hot Creator','\u00A350 monthly bonus','Exclusive events','Brand collaboration opps','Custom content support'],quote:'Top-tier creators earn significant income and get exclusive perks.'},
            {tier:'Legend',req:'500+ bookings/mo',earnings:'\u00A32,000-5,000+',icon:'\ud83c\udfc6',col:'purple',perks:['Everything in Elite','Revenue share deal','\u00A3100 monthly bonus','Personal account manager','Speaking opportunities'],quote:'The ultimate tier \u2014 build a full income stream from gym content.'},
          ].map(t=>`
            <div class="bg-card rounded-2xl p-6 border border-slate-700/50 hover:border-${t.col==='brand'?'brand':t.col+'-500'}/30 transition-all flex flex-col">
              <div class="text-center mb-4">
                <div class="text-4xl mb-2">${t.icon}</div>
                <h3 class="text-${t.col==='brand'?'brand':t.col+'-400'} font-bold text-xl">${t.tier}</h3>
                <p class="text-slate-500 text-xs mt-1">${t.req}</p>
              </div>
              <div class="bg-slate-800/50 rounded-xl p-4 mb-4">
                <p class="text-white font-bold text-2xl text-center">${t.earnings}<span class="text-slate-500 text-sm">/mo</span></p>
              </div>
              <ul class="space-y-2 mb-4 flex-grow">
                ${t.perks.map(p=>`<li class="flex items-start gap-2 text-sm"><span class="text-brand mt-0.5">✓</span><span class="text-slate-300">${p}</span></li>`).join('')}
              </ul>
              <div class="pt-4 border-t border-slate-700/50">
                <p class="text-slate-500 text-xs italic leading-relaxed">${t.quote}</p>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="hidden lg:flex justify-center items-center mt-6 gap-2 text-sm">
          <span class="text-slate-600">Your journey:</span>
          <span>🌱</span><span class="text-slate-700">→</span><span>🔥</span><span class="text-slate-700">→</span><span>⭐</span><span class="text-slate-700">→</span><span>👑</span>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  ASSET LIBRARY — Downloadable creator toolkit               -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section id="fs-assets" class="px-4 py-16 bg-slate-900">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-8">
          <h2 class="font-brand text-3xl md:text-4xl font-bold text-white mb-3">Ready-to-Go Assets</h2>
          <p class="text-slate-400 max-w-2xl mx-auto">Professional images, videos, stories, and posts — designed for ScanSquad creators. Download, customise, post.</p>
          <p class="text-brand font-bold text-lg mt-2">${assets.length} assets and growing</p>
        </div>
        
        <!-- Filter tabs -->
        <div class="flex flex-wrap justify-center gap-2 mb-8">
          <button onclick="window._fsFilter('all')" class="fs-filter-btn bg-brand text-white px-4 py-2 rounded-full text-sm font-medium" data-f="all">All (${assets.length})</button>
          <button onclick="window._fsFilter('image')" class="fs-filter-btn bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium" data-f="image">📸 Images (${assets.filter(a=>a.type==='image').length})</button>
          <button onclick="window._fsFilter('video')" class="fs-filter-btn bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium" data-f="video">🎬 Videos (${assets.filter(a=>a.type==='video').length})</button>
        </div>

        <!-- Asset grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="fs-grid">
          ${assets.map(a=>{
            const folderMap = {
      'AI Cinematic':'videos/ai_cinematic',
      'Audience Posts':'images/audience_posts',
      'Banners':'images/banners_covers',
      'Branded':'images/branded',
      'CMO Content':'videos/content',
      'CTA Templates':'images/cta_templates',
      'City Promo Reels':'videos/city_promos_vertical',
      'City Promo Square':'videos/city_promos_square',
      'City Promos':'images/city_promos',
      'Creator Assets':'images/creator_assets',
      'Daily Motivation':'images/daily_motivation',
      'Did You Know':'images/did_you_know',
      'Did You Know Videos':'videos/did_you_know',
      'Engagement Posts':'images/engagement_posts',
      'General Videos':'videos/general',
      'Gym Spotlights':'images/gym_spotlights',
      'Hero Videos':'videos/hero',
      'Influencer Clips':'videos/influencer',
      'Instagram Posts':'images/instagram_posts',
      'Instagram Stories':'images/instagram_stories',
      'Lifestyle AI':'images/lifestyle_ai',
      'Marketing':'images/marketing',
      'Mascot':'images/mascot',
      'Memes':'images/memes',
      'Price Comparison Vids':'videos/price_comparisons',
      'Price Comparisons':'images/price_comparisons',
      'Product Features':'images/product_features',
      'Promo Videos':'videos/promo',
      'Quotes & Stats':'images/quotes_stats',
      'Ready-to-Post':'videos/ready_to_post',
      'Seasonal Themes':'images/seasonal_themes',
      'Social Banners':'images/social_banners_ai',
      'Social Covers':'images/social_covers',
      'Social Packs':'images/marketing',
      'Story Templates':'images/story_templates',
      'TikTok-Reels AI':'videos/tiktok_reels_ai',
      'UGC Videos':'videos/ugc',
      'Viral Videos':'videos/viral',
      'YouTube AI':'videos/youtube_ai',
      'YouTube Thumbs':'images/youtube_thumbs',
      'YouTube Thumbs AI':'images/youtube_thumbs_ai',
    };
            const folder = folderMap[a.cat] || 'images/marketing';
            const driveUrl=d=>`https://drive.google.com/uc?export=download&id=${d}`;
            const ctrCat=c=>c.toLowerCase().replace(/\s+/g,'_').replace(/&/g,'and').replace(/-/g,'_');
            const ctrThumb=(c,f)=>`${A}/thumbs_ctr/${ctrCat(c)}/${f.replace(/\.[^.]+$/,'')}.webp`;
            return`
            <div class="fs-asset group relative bg-card rounded-xl overflow-hidden border border-slate-700/30 hover:border-brand/30 transition" data-t="${a.type}">
              <div class="aspect-square bg-slate-800 overflow-hidden relative">
                <img src="${ctrThumb(a.cat,a.file)}" alt="${a.name}" class="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" width="250" height="250" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\'flex items-center justify-center h-full text-3xl\'>${a.type==='video'?'🎬':'📸'}</div>'">${a.type==='video'?`<div class="absolute inset-0 flex items-center justify-center pointer-events-none"><div class="w-12 h-12 bg-brand/80 rounded-full flex items-center justify-center group-hover:bg-brand transition shadow-lg"><span class="text-white text-lg ml-0.5">▶</span></div></div>`:``}
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                  <a href="${a.did?`https://drive.google.com/uc?export=download&id=${a.did}`:`${A}/${folder}/${a.file}`}" download="${a.file}" onclick="event.stopPropagation()" class="bg-brand hover:bg-green-500 text-white text-[10px] px-2.5 py-1.5 rounded-full font-bold shadow-lg flex items-center gap-1 no-underline" title="Download ${a.name}">⬇ Download</a>
                </div>
              </div>
              <div class="p-2.5 flex items-center justify-between">
                <div class="min-w-0 flex-1">
                  <p class="text-white text-xs font-medium truncate">${a.name}</p>
                  <p class="text-slate-500 text-[10px]">${a.cat}</p>
                </div>
                <a href="${a.did?`https://drive.google.com/uc?export=download&id=${a.did}`:`${A}/${folder}/${a.file}`}" download="${a.file}" onclick="event.stopPropagation()" class="ml-2 flex-shrink-0 bg-slate-700 hover:bg-brand text-white rounded-lg p-1.5 transition" title="Download">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
              </div>
            </div>`;
          }).join('')}
        </div>

        <div class="text-center mt-8">
          <button onclick="window.open('${A}/ScanSquad-Creator-Toolkit.zip','_blank')" class="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-8 py-4 rounded-xl transition border border-slate-700">
            <span class="text-xl">📦</span> Download All Assets (ZIP)
          </button>
          <p class="text-slate-600 text-xs mt-2">All images, videos, captions, and posting guide in one download</p>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  FAST TRACK — Tools & support (Shopify pattern)            -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-12">Fast Track Your Success</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {title:'Personal Dashboard',desc:'Track clicks, bookings, earnings, and payouts in real-time. See exactly what\'s working.',icon:'📊'},
            {title:'242+ Assets',desc:'Professionally designed images, videos, stories, and reels. Download and post — done.',icon:'🎨'},
            {title:'Creator Playbook',desc:'Step-by-step guides, caption templates, hashtag lists, and posting schedules that convert.',icon:'📖'},
            {title:'Weekly Payouts',desc:'Earnings hit your bank every week. No minimum threshold. Direct bank transfer.',icon:'💳'},
          ].map(f=>`
            <div class="bg-card rounded-2xl p-6 border border-slate-700/50 hover:border-brand/20 transition text-center">
              <div class="text-4xl mb-4">${f.icon}</div>
              <h3 class="text-white font-bold text-lg mb-2">${f.title}</h3>
              <p class="text-slate-400 text-sm">${f.desc}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  LEADERBOARD — Competitive social proof                    -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900">
      <div class="max-w-4xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">ScanSquad Leaderboard</h2>
        <p class="text-slate-400 text-center mb-10">Top creators this month. Could be you next. 🏆</p>
        <div class="bg-card rounded-2xl border border-slate-700/50 overflow-hidden">
          <div class="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-700/50 text-slate-500 text-xs font-medium uppercase tracking-wider">
            <div class="col-span-1">#</div><div class="col-span-5">Creator</div><div class="col-span-3 text-right">Bookings</div><div class="col-span-3 text-right">Earned</div>
          </div>
          ${[
            {r:1,n:'S****a K.',t:'👑',b:612,e:'£3,240',badge:'Legend'},
            {r:2,n:'J****s M.',t:'⭐',b:287,e:'£1,580',badge:'Elite'},
            {r:3,n:'P****a R.',t:'⭐',b:194,e:'£1,120',badge:'Elite'},
            {r:4,n:'A****d T.',t:'\ud83d\udd25',b:89,e:'\u00a3490',badge:'Hot Creator'},
            {r:5,n:'L****a W.',t:'\ud83d\udd25',b:67,e:'\u00a3380',badge:'Hot Creator'},
            {r:6,n:'You?',t:'\ud83c\udf31',b:'\u2014',e:'Join now \u2192',badge:'Starter',hl:true},
          ].map(l=>`
            <div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-800/50 ${l.hl?'bg-brand/5 hover:bg-brand/10 cursor-pointer':'hover:bg-slate-800/30'} transition items-center" ${l.hl?'onclick="navigate(\'/login\')"':''}>
              <div class="col-span-1 font-bold ${l.r<=3?'text-brand':'text-slate-400'}">${l.r<=3?['🥇','🥈','🥉'][l.r-1]:l.r}</div>
              <div class="col-span-5 flex items-center gap-2"><span>${l.t}</span><span class="${l.hl?'text-brand font-bold':'text-white font-medium'}">${l.n}</span><span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 hidden sm:inline">${l.badge}</span></div>
              <div class="col-span-3 text-right text-slate-300 font-medium">${typeof l.b==='number'?l.b.toLocaleString():l.b}</div>
              <div class="col-span-3 text-right ${l.hl?'text-brand font-bold':'text-brand font-medium'}">${l.e}</div>
            </div>
          `).join('')}
        </div>
        <p class="text-slate-600 text-xs text-center mt-4">Updated weekly · Names partially hidden for privacy</p>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  FAQ — Accordion                                           -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-3xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-10">Frequently Asked Questions</h2>
        <div class="space-y-3">
          ${[
            {q:'How much does it cost to join ScanSquad?',a:'Nothing. Zero. ScanSquad is completely free to join. Sign up, get your link, start earning immediately.'},
            {q:'How much can I realistically earn?',a:'Starters typically earn \u00a350-150/mo, Rising Stars \u00a3150-400/mo, Hot Creators \u00a3400-800/mo, Elite \u00a3800-2,000/mo, and Legends \u00a32,000-5,000+/mo. Commission is 25% of every booking ('+sgCommissionRange()+' each).'},
            {q:'Do I need a minimum number of followers?',a:'No! We have no follower requirements. Some of our top earners started with small, highly engaged audiences. Quality over quantity.'},
            {q:'How and when do I get paid?',a:'Earnings are paid weekly via direct bank transfer. No minimum payout threshold — even £5 gets sent.'},
            {q:'What content should I post?',a:'Anything gym-related! Gym tours, workout clips, reviews, booking walkthroughs, money-saving tips. We provide 242+ ready-made assets and a creator playbook with caption templates.'},
            {q:'How does tracking work?',a:'When someone clicks your link (scangym.com/r/yourname), a 30-day cookie tracks them. Any booking within 30 days earns you 25% commission — even if they don\'t book immediately.'},
            {q:'Can I use the assets on any platform?',a:'Yes! Assets are designed for Instagram, TikTok, YouTube, Twitter/X, Facebook, and blogs. Download and use freely — they\'re yours.'},
            {q:'Is ScanSquad only for UK creators?',a:'ScanGym gyms are currently UK-based, so the audience who books will be UK users. But you can join from anywhere if you have a UK-interested audience.'},
          ].map(f=>`
            <div class="border border-slate-700/50 rounded-xl overflow-hidden">
              <button class="accordion-trigger w-full flex items-center justify-between p-5 text-left hover:bg-slate-800/30 transition">
                <span class="text-white font-medium pr-4">${f.q}</span>
                <span class="accordion-arrow text-slate-500 transition-transform text-sm flex-shrink-0">▼</span>
              </button>
              <div class="overflow-hidden transition-all duration-300" style="max-height:0">
                <p class="text-slate-400 text-sm p-5 pt-0 leading-relaxed">${f.a}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    
    <!-- Creator Spotlight -->
    <section class="px-4 py-16">
      <div class="max-w-6xl mx-auto text-center">
        <h2 class="font-brand text-3xl font-bold text-white mb-3">\ud83c\udf1f Creator Spotlight</h2>
        <p class="text-slate-400 mb-8">This month's featured ScanSquad creator</p>
        <div class="bg-card rounded-2xl border border-brand/20 p-8 max-w-lg mx-auto">
          <div class="text-4xl mb-3">\ud83d\udcaa</div>
          <h3 class="text-white font-bold text-xl">James M. \u2014 Manchester</h3>
          <p class="text-brand font-semibold">@jamesgymlife \u00b7 34K followers</p>
          <p class="text-slate-300 text-sm mt-3 mb-4">"ScanSquad changed my content game. I post gym reviews, use the free assets, and earn \u00a3340/mo in passive commissions."</p>
          <div class="flex justify-center gap-4 text-sm">
            <div class="bg-slate-800 rounded-lg px-4 py-2"><span class="text-brand font-bold">\u00a3340</span><br><span class="text-slate-500 text-xs">monthly</span></div>
            <div class="bg-slate-800 rounded-lg px-4 py-2"><span class="text-brand font-bold">209</span><br><span class="text-slate-500 text-xs">bookings</span></div>
            <div class="bg-slate-800 rounded-lg px-4 py-2"><span class="text-brand font-bold">\ud83d\udd25</span><br><span class="text-slate-500 text-xs">Hot Creator</span></div>
          </div>
          <a onclick="navigate('/become-a-creator')" class="mt-6 bg-brand hover:bg-orange-600 text-white font-bold px-6 py-3 rounded-xl cursor-pointer transition inline-block">Join ScanSquad \u2192</a>
        </div>
      </div>
    </section>
<!--  FINAL CTA                                                 -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-20 bg-gradient-to-b from-slate-900 to-slate-950">
      <div class="max-w-3xl mx-auto text-center">
        <div class="text-5xl mb-6">💪</div>
        <h2 class="font-brand text-3xl md:text-5xl font-bold text-white mb-4">Ready to Join ScanSquad?</h2>
        <p class="text-slate-400 text-lg mb-8 max-w-xl mx-auto">Free to join · 25% commission · 242+ assets · Weekly payouts · No caps · No minimum followers</p>
        <button onclick="state.user?window._sg1ClickCreatorSignup():navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-10 py-5 rounded-xl transition text-xl shadow-lg shadow-brand/20 hover:shadow-brand/40">Join ScanSquad — Start Earning Today</button>
        <p class="text-slate-600 text-sm mt-4">Your personal page: <span class="text-brand">scangym.com/r/yourname</span></p>
      </div>
    </section>

  </div>`;
}

function CreatorEarningsPage(){
  // Get creator handle from localStorage (set during creator signup)
  const creatorData=JSON.parse(localStorage.getItem('sg_creator')||'null');
  const handle=creatorData?.handle||creatorData?.slug||'';
  
  if(!handle){
    return `<div class="max-w-md mx-auto mt-20 text-center px-4">
      <p class="text-5xl mb-4">💰</p>
      <h1 class="text-2xl font-bold text-white mb-3">Creator Earnings</h1>
      <p class="text-slate-400 mb-6">Sign up as a ScanSquad creator to track your earnings.</p>
      <button onclick="navigate('/upload')" class="bg-brand hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-xl transition">Join ScanSquad →</button>
    </div>`;
  }

  // Load earnings + withdrawal data async, then update dashboard extras
  // Sync handle to DB so wallet reconciliation can find it
  if(state.user&&handle){fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:handle})}).catch(function(){});}
  setTimeout(function(){_loadCreatorEarnings(handle);_loadWithdrawalData(handle);_loadCreatorAnalytics(handle);},100);_sgStartBookingAlerts(handle);
  // #56: Auto-refresh every 30s for real-time feel
  if(window._ceRefreshTimer)clearInterval(window._ceRefreshTimer);
  window._ceRefreshTimer=setInterval(function(){_loadCreatorEarnings(handle);_loadWithdrawalData(handle);},30000);

  // Creator level system
  const levels=[
    {name:'Starter',emoji:'🌱',min:0,color:'#94a3b8'},
    {name:'Rising Star',emoji:'⚡',min:5,color:'#38bdf8'},
    {name:'Hot Creator',emoji:'🔥',min:25,color:'#f97316'},
    {name:'Elite',emoji:'💎',min:100,color:'#a855f7'},
    {name:'Legend',emoji:'🏆',min:500,color:'#eab308'}
  ];

  return `<div class="max-w-lg mx-auto px-4 pt-6 pb-24" id="creator-earnings-root">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h1 class="text-2xl font-bold text-white">Your Dashboard</h1>
        <p class="text-slate-400 text-sm">scangym.com/r/${handle}</p>
      </div>
      <button onclick="navigator.clipboard.writeText('https://scangym.com/r/${handle}');sgToast('Link copied!','success',2000)" class="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-sm transition">📋 Copy Link</button>
    </div>

    <!-- R7-A05: Payout Method Status -->
    <div id="ce-payout-banner" class="bg-gradient-to-r from-purple-900/20 to-blue-900/20 rounded-xl p-4 mb-4 border border-purple-700/30">
      <div class="flex items-center gap-3">
        <div id="ce-payout-icon" style="width:40px;height:40px;background:rgba(239,68,68,.1);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">\u26a0\ufe0f</div>
        <div class="flex-1">
          <p id="ce-payout-title" class="text-white font-bold text-sm">Payout Not Set Up</p>
          <p id="ce-payout-desc" class="text-slate-400 text-xs">Connect a bank account or Stripe to withdraw your earnings</p>
        </div>
        <button id="ce-payout-action-btn" onclick="document.getElementById('ce-payment-form').classList.remove('hidden');document.getElementById('ce-payment-form').scrollIntoView({behavior:'smooth'})" class="bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-2 rounded-lg text-xs transition whitespace-nowrap">Set Up</button>
      </div>
    </div>

    <!-- ═══ CREATOR LEVEL BADGE ═══ -->
    <div id="ce-level-badge" class="bg-gradient-to-r from-slate-800 to-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/50">
      <div class="flex items-center gap-3">
        <span class="text-3xl" id="ce-level-emoji">🌱</span>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <p class="text-white font-bold" id="ce-level-name">Starter</p>
            <span class="text-xs px-2 py-0.5 rounded-full font-medium" id="ce-level-pill" style="background:rgba(148,163,184,.15);color:#94a3b8">Level 1</span>
          </div>
          <p class="text-slate-400 text-xs mt-0.5" id="ce-level-next">5 bookings to reach ⚡ Rising Star</p>
        </div>
      </div>
    </div>

    <!-- ═══ EARNINGS GOAL BAR ═══ -->
    <div id="ce-goal-bar" class="bg-slate-800/80 rounded-xl p-4 mb-4 border border-slate-700/50">
      <div class="flex items-center justify-between mb-2">
        <p class="text-white font-bold text-sm">🎯 Earnings Goal</p>
        <p class="text-brand font-bold text-sm" id="ce-goal-text">${sgSymbol()}0 / ${sgSymbol()}10</p>
      </div>
      <div class="w-full bg-slate-700/50 rounded-full h-3 overflow-hidden">
        <div id="ce-goal-fill" class="h-full rounded-full transition-all duration-1000 ease-out" style="width:0%;background:linear-gradient(90deg,#FF6D00,#FF9100)"></div>
      </div>
      <p class="text-slate-400 text-xs mt-2" id="ce-goal-nudge">Share your link to start earning!</p>
    </div>

    <!-- ═══ STREAK TRACKER ═══ -->
    <div id="ce-streak" class="bg-slate-800/80 rounded-xl p-3 mb-4 border border-slate-700/50 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xl">🔥</span>
        <div>
          <p class="text-white font-bold text-sm"><span id="ce-streak-count">0</span>-day streak</p>
          <p class="text-slate-500 text-xs" id="ce-streak-msg">Share your link daily to build a streak!</p>
        </div>
      </div>
      <div class="flex gap-1" id="ce-streak-dots">
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
        <div class="w-2 h-2 rounded-full bg-slate-600"></div>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
        <p class="text-2xl font-black text-white" id="ce-earnings">—</p>
        <p class="text-slate-400 text-xs mt-1">Total Earned</p>
      </div>
      <div class="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
        <p class="text-2xl font-black text-white" id="ce-conversions">—</p>
        <p class="text-slate-400 text-xs mt-1">Bookings</p>
      </div>
      <div class="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
        <p class="text-2xl font-black text-white" id="ce-clicks">—</p>
        <p class="text-slate-400 text-xs mt-1">Link Clicks</p>
      </div>
    </div>

    <!-- #63: Period Selector -->
    <div class="flex gap-2 mb-3" id="ce-period-tabs">
      <button onclick="_ceSetPeriod('today')" id="ce-period-today" class="flex-1 bg-brand/20 text-brand font-bold py-2 rounded-lg text-xs transition border border-brand/30">Today</button>
      <button onclick="_ceSetPeriod('week')" id="ce-period-week" class="flex-1 bg-slate-700/50 text-slate-400 font-bold py-2 rounded-lg text-xs transition border border-transparent">This Week</button>
      <button onclick="_ceSetPeriod('all')" id="ce-period-all" class="flex-1 bg-slate-700/50 text-slate-400 font-bold py-2 rounded-lg text-xs transition border border-transparent">All Time</button>
    </div>

    <!-- Conversion Rate -->
    <div class="bg-gradient-to-r from-brand/10 to-emerald-500/10 border border-brand/20 rounded-xl p-4 mb-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-white font-bold">Conversion Rate</p>
          <p class="text-slate-400 text-xs">Clicks → Bookings</p>
        </div>
        <p class="text-3xl font-black text-brand" id="ce-rate">—%</p>
      </div>
    </div>

    <!-- #63: Downloads & Shares Tracker -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
        <p class="text-2xl font-black text-white" id="ce-downloads">—</p>
        <p class="text-slate-400 text-xs mt-1">Asset Downloads</p>
      </div>
      <div class="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
        <p class="text-2xl font-black text-white" id="ce-shares">—</p>
        <p class="text-slate-400 text-xs mt-1">Link Shares</p>
      </div>
    </div>

    <!-- #63: 7-Day Activity Sparkline -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <p class="text-white font-bold text-sm mb-2">📈 Last 7 Days Activity</p>
      <div class="flex items-end gap-1 h-12" id="ce-sparkline">
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
        <div class="flex-1 bg-slate-700 rounded-t" style="height:10%"></div>
      </div>
      <div class="flex justify-between mt-1">
        <span class="text-slate-600 text-[9px]">Mon</span><span class="text-slate-600 text-[9px]">Tue</span><span class="text-slate-600 text-[9px]">Wed</span><span class="text-slate-600 text-[9px]">Thu</span><span class="text-slate-600 text-[9px]">Fri</span><span class="text-slate-600 text-[9px]">Sat</span><span class="text-slate-600 text-[9px]">Sun</span>
      </div>
    </div>

    <!-- #56: Conversion Funnel Mini -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <p class="text-white font-bold text-sm mb-3">🔄 Conversion Funnel</p>
      <div class="space-y-2" id="ce-funnel">
        <div class="flex items-center gap-3">
          <span class="text-xs w-16 text-slate-400">Clicks</span>
          <div class="flex-1 bg-slate-700/50 rounded-full h-4 overflow-hidden"><div id="ce-funnel-clicks" class="h-full rounded-full bg-blue-500 transition-all duration-700" style="width:100%"></div></div>
          <span class="text-xs text-white font-bold w-10 text-right" id="ce-funnel-clicks-n">—</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs w-16 text-slate-400">Signups</span>
          <div class="flex-1 bg-slate-700/50 rounded-full h-4 overflow-hidden"><div id="ce-funnel-signups" class="h-full rounded-full bg-purple-500 transition-all duration-700" style="width:0%"></div></div>
          <span class="text-xs text-white font-bold w-10 text-right" id="ce-funnel-signups-n">—</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs w-16 text-slate-400">Bookings</span>
          <div class="flex-1 bg-slate-700/50 rounded-full h-4 overflow-hidden"><div id="ce-funnel-bookings" class="h-full rounded-full bg-brand transition-all duration-700" style="width:0%"></div></div>
          <span class="text-xs text-white font-bold w-10 text-right" id="ce-funnel-bookings-n">—</span>
        </div>
      </div>
    </div>

    <!-- ═══ CHANNEL ANALYTICS (Amazon Tracking IDs) ═══ -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between mb-3">
        <p class="text-white font-bold text-sm">📡 Channel Analytics</p>
        <span class="text-xs text-slate-500">Like Amazon Tracking IDs</span>
      </div>
      <div id="ce-channels" style="min-height:20px">
        <p class="text-slate-500 text-xs">Share your link on different platforms to see per-channel stats here.</p>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <button onclick="window._sgCopyChannelLink('${handle}','tiktok')" class="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg px-2 py-2 text-center transition" title="Copy TikTok link"><span class="text-sm">🎵</span><p class="text-slate-400 text-[9px] mt-1">TikTok</p></button>
        <button onclick="window._sgCopyChannelLink('${handle}','instagram')" class="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg px-2 py-2 text-center transition" title="Copy Instagram link"><span class="text-sm">📸</span><p class="text-slate-400 text-[9px] mt-1">Instagram</p></button>
        <button onclick="window._sgCopyChannelLink('${handle}','youtube')" class="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg px-2 py-2 text-center transition" title="Copy YouTube link"><span class="text-sm">🎬</span><p class="text-slate-400 text-[9px] mt-1">YouTube</p></button>
      </div>
    </div>

    <!-- ═══ P1: ADVANCED CREATOR ANALYTICS (YouTube Studio style) ═══ -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between mb-2">
        <p class="text-white font-bold text-sm">\ud83d\udcc8 Earnings Graph</p>
        <div class="flex gap-1" id="ca-bucket-tabs">
          <button onclick="_caSetBucket('${handle}','day')" id="ca-b-day" class="bg-brand/20 text-brand text-[10px] font-bold px-2 py-1 rounded transition">Daily</button>
          <button onclick="_caSetBucket('${handle}','week')" id="ca-b-week" class="bg-slate-700/50 text-slate-400 text-[10px] font-bold px-2 py-1 rounded transition">Weekly</button>
          <button onclick="_caSetBucket('${handle}','month')" id="ca-b-month" class="bg-slate-700/50 text-slate-400 text-[10px] font-bold px-2 py-1 rounded transition">Monthly</button>
        </div>
      </div>
      <div id="ca-earnings-chart" style="min-height:110px"><p class="text-slate-500 text-xs">Loading chart...</p></div>
      <div class="flex items-center gap-3 mt-2">
        <span class="flex items-center gap-1 text-[9px] text-slate-400"><span style="width:8px;height:8px;border-radius:2px;background:#FF6D00;display:inline-block"></span>Earnings</span>
        <span class="flex items-center gap-1 text-[9px] text-slate-400"><span style="width:8px;height:8px;border-radius:2px;background:#38bdf8;display:inline-block"></span>Clicks</span>
        <span class="ml-auto text-brand text-[10px] font-bold" id="ca-chart-total"></span>
      </div>
    </div>

    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between mb-3">
        <p class="text-white font-bold text-sm">\ud83c\udfcb\ufe0f Top Gyms From Your Link</p>
        <span class="text-xs text-slate-500">Per-gym clicks</span>
      </div>
      <div id="ca-gyms"><p class="text-slate-500 text-xs">Loading...</p></div>
    </div>

    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between mb-3">
        <p class="text-white font-bold text-sm">\ud83d\udca1 Audience Insights</p>
        <span class="text-xs text-slate-500">Channel + timing</span>
      </div>
      <div id="ca-audience"><p class="text-slate-500 text-xs">Loading...</p></div>
    </div>

    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between mb-3">
        <p class="text-white font-bold text-sm">\ud83c\udfac Your Reels</p>
        <button onclick="navigate('/upload')" class="bg-brand/20 hover:bg-brand/30 text-brand text-[10px] font-bold px-2 py-1 rounded transition">+ Upload Reel</button>
      </div>
      <div id="ca-reels"><p class="text-slate-500 text-xs">Loading...</p></div>
    </div>

    <!-- ═══ SIGNUP BOUNTIES ═══ -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <div class="flex items-center justify-between">
        <p class="text-white font-bold text-sm">🎯 Signup Bounties</p>
        <span class="bg-emerald-500/15 text-emerald-400 text-xs font-bold px-2 py-1 rounded-full">£1 per signup</span>
      </div>
      <p class="text-slate-400 text-xs mt-1 mb-2">Earn £1 for every new user who creates an account via your link — even if they don't book!</p>
      <div id="ce-bounties" class="text-sm"><span class="text-slate-500">Loading...</span></div>
    </div>

    <!-- ═══ NEXT ACTION NUDGE ═══ -->
    <div id="ce-nudge" class="bg-gradient-to-r from-brand/20 to-orange-600/10 border border-brand/30 rounded-xl p-4 mb-4">
      <div class="flex items-center gap-3">
        <span class="text-2xl">💡</span>
        <div class="flex-1">
          <p class="text-white font-bold text-sm" id="ce-nudge-title">Share your link!</p>
          <p class="text-slate-300 text-xs" id="ce-nudge-text">Post your creator link on Instagram Stories to get your first booking.</p>
        </div>
        <button onclick="navigator.clipboard.writeText('https://scangym.com/r/${handle}');sgToast('Link copied! Now share it 🚀','success',2000)" class="bg-brand/30 hover:bg-brand/40 text-brand font-bold px-3 py-2 rounded-lg text-xs transition whitespace-nowrap">Copy Link</button>
      </div>
    </div>

    <!-- Commission Info -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <p class="text-white font-bold mb-2">💰 How you earn</p>
      <div class="space-y-2 text-sm text-slate-300">
        <div class="flex justify-between"><span>Commission per booking</span><span class="text-brand font-bold">£1.25</span></div>
        <div class="flex justify-between"><span>Signup bounty</span><span class="text-emerald-400 font-bold">£1.00</span></div>
        <div class="flex justify-between"><span>Customer discount</span><span class="text-emerald-400 font-bold">15% off</span></div>
        <div class="flex justify-between"><span>Cookie duration</span><span class="text-slate-400">30 days</span></div>
        <div class="flex justify-between"><span>Clearing period</span><span class="text-slate-400">7 days</span></div>
        <div class="flex justify-between"><span>Payout methods</span><span class="text-slate-400">Stripe Connect · Bank · PayPal</span></div>
      </div>
    </div>

    <!-- ═══ CREATOR LEVEL PROGRESS ═══ -->
    <div class="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/30">
      <p class="text-white font-bold mb-3">🏆 Creator Levels</p>
      <div class="space-y-3" id="ce-levels-list">
        ${levels.map(function(lv,i){
          return '<div class="flex items-center gap-3"><span class="text-lg">'+lv.emoji+'</span><div class="flex-1"><div class="flex items-center justify-between"><p class="text-white text-sm font-medium">'+lv.name+'</p><p class="text-slate-500 text-xs">'+lv.min+'+ bookings</p></div></div><span class="text-xs" id="ce-level-check-'+i+'" style="color:'+lv.color+'">○</span></div>';
        }).join('')}
      </div>
    </div>

    <!-- Wallet Balance & Withdraw Section -->
    <div class="mb-4">
      <div class="flex items-center justify-between mb-3">
        <p class="text-white font-bold">💰 ScanGym Wallet</p>
      </div>
      <div id="ce-withdraw-section" class="bg-gradient-to-r from-brand/10 to-emerald-500/10 rounded-xl p-4 border border-brand/20">
        <div class="flex items-center justify-between mb-3">
          <div>
            <p class="text-slate-400 text-xs">Wallet Balance</p>
            <p class="text-2xl font-black text-white" id="ce-available">—</p>
            <p class="text-emerald-400 text-[10px] mt-1">✨ Earnings auto-credited to wallet</p>
          </div>
          <button onclick="navigate('/wallet')" class="bg-brand hover:bg-orange-600 text-white font-bold py-2 px-5 rounded-xl text-sm transition">Withdraw</button>
        </div>
        <p class="text-slate-500 text-xs">Go to your ScanGym Wallet to withdraw to bank account or spend on gym sessions.</p>
      </div>
    </div>

    <!-- R7-A06: Withdrawal History with Timeline -->
    <div class="mb-6">
      <p class="text-white font-bold mb-3">Withdrawal History</p>
      <div id="ce-withdraw-history" class="space-y-2">
        <div class="bg-slate-800/40 rounded-lg p-3 text-center text-slate-500 text-sm">No withdrawals yet</div>
      </div>
    </div>

    <!-- Recent Conversions -->
    <div class="mb-6">
      <p class="text-white font-bold mb-3">Recent Bookings</p>
      <div id="ce-recent" class="space-y-2">
        <div class="bg-slate-800/40 rounded-lg p-4 text-center text-slate-500 text-sm">Loading...</div>
      </div>
    </div>
  </div>`;
}

window._sgCreatorTierSheet=function(handle){
  fetch('/api/referrals/stats/'+encodeURIComponent(handle))
    .then(function(r){return r.json();})
    .then(function(d){
      var conv=d.conversions||0;
      var tiers=window._sgTierDefs;
      var cur=tiers[0],next=null;
      for(var i=0;i<tiers.length;i++){if(conv>=tiers[i].min)cur=tiers[i];else{next=tiers[i];break;}}
      var pct=next?Math.min(100,Math.round((conv/next.min)*100)):100;
      var html='<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">'+cur.badge+' '+cur.name+'</h2>'
        +'<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 14px">'+conv+' referral'+(conv===1?'':'s')+' so far</p>'
        +'<div style="background:#1a1a1a;border-radius:16px;padding:16px;border:1px solid rgba(255,255,255,.08);margin-bottom:14px">'
        +(next
          ?'<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:#fff;font-size:12px;font-weight:700">Progress to '+next.badge+' '+next.name+'</span><span style="color:#FF6D00;font-size:12px;font-weight:700">'+conv+' / '+next.min+'</span></div>'
           +'<div style="background:rgba(255,255,255,.08);border-radius:8px;height:10px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,#FF6D00,#FF9100);border-radius:8px;transition:width 1s"></div></div>'
           +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:8px 0 0">'+(next.min-conv)+' more referral'+((next.min-conv)===1?'':'s')+' to unlock: '+next.perks+'</p>'
          :'<p style="color:#eab308;font-size:13px;font-weight:700;margin:0">\ud83d\udc51 Max tier reached \u2014 you are a ScanSquad Legend!</p>')
        +'</div>'
        +tiers.map(function(t){
          var done=conv>=t.min;
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.05)">'
            +'<span style="font-size:20px">'+t.badge+'</span>'
            +'<div style="flex:1"><p style="color:#fff;font-size:13px;font-weight:600;margin:0">'+t.name+' <span style="color:rgba(255,255,255,.35);font-weight:400">\u00b7 '+t.min+'+ referrals</span></p>'
            +'<p style="color:rgba(255,255,255,.4);font-size:10px;margin:2px 0 0">'+t.perks+'</p></div>'
            +'<span style="color:'+(done?'#22c55e':'rgba(255,255,255,.25)')+';font-size:14px;font-weight:700">'+(done?'\u2713':'\u25cb')+'</span></div>';
        }).join('');
      _sgOpenSheet('sg-tier-sheet',html);
    })
    .catch(function(){sgToast('Could not load tier progress','error',2000);});
};

window._sgCreatorLeaderboardSheet=function(handle){
  fetch('/api/creators/leaderboard')
    .then(function(r){return r.json();})
    .then(function(d){
      var rows=d.leaderboard||[];
      var medals=['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'];
      var html='<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">\ud83c\udfc6 ScanSquad Leaderboard</h2>'
        +'<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 14px">Top creators by referrals</p>';
      if(!rows.length){html+='<p style="color:rgba(255,255,255,.4);font-size:13px">No creators on the board yet \u2014 your spot is waiting!</p>';}
      else{
        html+=rows.map(function(c,i){
          var name=(c.community_name||('Creator '+String(c.user_id||'').slice(0,6))).replace(/</g,'&lt;');
          var isMe=c.community_name&&handle&&c.community_name.toLowerCase()===handle.toLowerCase();
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 8px;border-radius:10px;margin-bottom:2px;'+(isMe?'background:rgba(255,109,0,.12);border:1px solid rgba(255,109,0,.3)':'border-bottom:1px solid rgba(255,255,255,.05)')+'">'
            +'<span style="width:26px;text-align:center;font-size:'+(i<3?'16px':'12px')+';color:rgba(255,255,255,.5);font-weight:700">'+(i<3?medals[i]:(i+1))+'</span>'
            +'<span style="font-size:16px">'+(c.badge||'\ud83c\udf31')+'</span>'
            +'<div style="flex:1;min-width:0"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+name+(isMe?' <span style=\'color:#FF6D00;font-size:10px\'>(you)</span>':'')+'</p></div>'
            +'<span style="color:#FF6D00;font-size:12px;font-weight:700">'+(c.total_referrals||0)+' refs</span></div>';
        }).join('');
      }
      _sgOpenSheet('sg-leaderboard-sheet',html);
    })
    .catch(function(){sgToast('Could not load leaderboard','error',2000);});
};

window._sgCreatorPageSheet=function(handle){
  var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
  function inp(id,label,ph,val){
    return '<label style="display:block;color:rgba(255,255,255,.5);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px">'+label+'</label>'
      +'<input id="'+id+'" placeholder="'+ph+'" value="'+String(val||'').replace(/"/g,'&quot;')+'" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px;color:#fff;font-size:13px;outline:none;box-sizing:border-box">';
  }
  var html='<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">\ud83c\udfa8 Customise Your Page</h2>'
    +'<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 8px">scangym.com/r/'+handle+'</p>'
    +inp('sg-cp-name','Display name','Your name',cd.name||'')
    +inp('sg-cp-headline','Headline','e.g. I train with ScanGym \u2014 join me','')
    +inp('sg-cp-sub','Subheadline','e.g. 50% off your first session','')
    +inp('sg-cp-photo','Photo URL','https://... your profile photo','')
    +inp('sg-cp-cta','Button text','Book Your First Session \u2014 50% Off','')
    +inp('sg-cp-msg','Personal message','Tell your followers why you love these gyms','')
    +'<div style="display:flex;gap:8px;margin-top:16px">'
    +'<button onclick="_sgCreatorPageSave(\''+handle+'\')" style="flex:1;background:#FF6D00;color:#fff;border:none;padding:13px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">Save Page</button>'
    +'<button onclick="navigate(\'/r/'+handle+'\')" style="flex:1;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12);padding:13px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">View Page</button>'
    +'</div>';
  _sgOpenSheet('sg-custompage-sheet',html);
};

window._sgCreatorPageSave=function(handle){
  var g=function(id){var el=document.getElementById(id);return el?el.value.trim():'';};
  var body={slug:handle,creatorHandle:handle,creatorName:g('sg-cp-name'),headline:g('sg-cp-headline'),subheadline:g('sg-cp-sub'),creatorPhotoUrl:g('sg-cp-photo'),ctaText:g('sg-cp-cta'),customMessage:g('sg-cp-msg')};
  fetch('/api/creators/landing-page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){
      if(r.status===401){sgToast('Sign in to customise your page','info',2500);if(typeof window._sgShowAuthSheet==='function')window._sgShowAuthSheet('book');return null;}
      if(r.status===403){sgToast('Join ScanSquad first \u2014 tap 1-Click Signup','info',2500);return null;}
      return r.json();
    })
    .then(function(d){
      if(d&&(d.success||d.liveUrl||d.page)){sgToast('Page saved! \ud83c\udf89','success',2000);}
      else if(d&&d.error){sgToast(d.error,'error',2500);}
    })
    .catch(function(){sgToast('Could not save page','error',2000);});
};

function _loadCreatorAnalytics(handle){
  _caSetBucket(handle,window._caBucket||'day');
  fetch('/api/creator-analytics/'+encodeURIComponent(handle)+'/gyms')
    .then(function(r){return r.json();})
    .then(function(d){
      var el=document.getElementById('ca-gyms');if(!el)return;
      var gyms=d.gyms||[];
      if(!gyms.length){el.innerHTML='<p class="text-slate-500 text-xs">No gym clicks yet. Use Deep Link on a gym page to create gym-specific links.</p>';return;}
      var maxClicks=gyms[0].clicks||1;
      el.innerHTML=gyms.slice(0,8).map(function(g){
        var w=Math.max(4,Math.round((g.clicks/maxClicks)*100));
        return '<div class="mb-2"><div class="flex items-center justify-between mb-1">'
          +'<p class="text-white text-xs font-medium truncate" style="max-width:60%">'+String(g.gymName).replace(/</g,'&lt;')+'</p>'
          +'<p class="text-slate-400 text-[10px]">'+g.clicks+' clicks \u00b7 '+g.conversions+' booked \u00b7 '+sgSymbol()+(g.earningsPence/100).toFixed(2)+'</p></div>'
          +'<div class="w-full bg-slate-700/40 rounded-full h-2 overflow-hidden"><div class="h-full rounded-full" style="width:'+w+'%;background:linear-gradient(90deg,#FF6D00,#FF9100)"></div></div></div>';
      }).join('');
    }).catch(function(){});
  fetch('/api/creator-analytics/'+encodeURIComponent(handle)+'/audience')
    .then(function(r){return r.json();})
    .then(function(d){
      var el=document.getElementById('ca-audience');if(!el)return;
      var srcs=d.sources||[],hours=d.byHour||[],dows=d.byWeekday||[];
      var total=srcs.reduce(function(a,s){return a+s.clicks;},0);
      if(!total){el.innerHTML='<p class="text-slate-500 text-xs">No audience data yet \u2014 insights appear after your first link clicks.</p>';return;}
      var chips=srcs.slice(0,6).map(function(s){
        var pct=Math.round((s.clicks/total)*100);
        return '<span class="bg-slate-700/50 text-slate-300 text-[10px] font-bold px-2 py-1 rounded-full">'+String(s.source).replace(/</g,'&lt;')+' '+pct+'%</span>';
      }).join(' ');
      var maxH=Math.max.apply(null,hours.concat([1]));
      var bars=hours.map(function(v,h){
        var hh=Math.max(6,Math.round((v/maxH)*100));
        var hot=v===maxH&&v>0?'#FF6D00':'#475569';
        return '<div title="'+h+':00 \u2014 '+v+' clicks" style="flex:1;height:'+hh+'%;background:'+hot+';border-radius:2px 2px 0 0"></div>';
      }).join('');
      var dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      var maxD=Math.max.apply(null,dows.concat([1]));
      var bestDay=dayNames[dows.indexOf(maxD)]||'\u2014';
      var peakHour=hours.indexOf(maxH);
      el.innerHTML='<div class="flex flex-wrap gap-1 mb-3">'+chips+'</div>'
        +'<p class="text-slate-400 text-[10px] mb-1">Clicks by hour (best: <span class="text-brand font-bold">'+(maxH>0?peakHour+':00':'\u2014')+'</span> \u00b7 best day: <span class="text-brand font-bold">'+bestDay+'</span>)</p>'
        +'<div style="display:flex;align-items:flex-end;gap:2px;height:40px">'+bars+'</div>'
        +'<div class="flex justify-between mt-1"><span class="text-slate-600 text-[9px]">00:00</span><span class="text-slate-600 text-[9px]">12:00</span><span class="text-slate-600 text-[9px]">23:00</span></div>';
    }).catch(function(){});
  fetch('/api/creator-analytics/'+encodeURIComponent(handle)+'/reels')
    .then(function(r){return r.json();})
    .then(function(d){
      var el=document.getElementById('ca-reels');if(!el)return;
      var reels=d.reels||[];
      if(!reels.length){el.innerHTML='<p class="text-slate-500 text-xs">No reels uploaded yet. Tap + Upload Reel to post your first gym video.</p>';return;}
      el.innerHTML=reels.slice(0,10).map(function(rl){
        var statusColor=rl.status==='approved'?'text-emerald-400':rl.status==='pending'?'text-yellow-400':'text-red-400';
        return '<div class="flex items-center gap-3 bg-slate-800/40 rounded-lg p-2 mb-2">'
          +'<span class="text-lg">\ud83c\udfac</span>'
          +'<div class="flex-1 min-w-0"><p class="text-white text-xs font-medium truncate">'+String(rl.caption).replace(/</g,'&lt;')+'</p>'
          +'<p class="text-slate-500 text-[10px]">'+rl.views+' views \u00b7 '+rl.avgWatchPercent+'% avg watch \u00b7 '+rl.completions+' completed</p></div>'
          +'<span onclick="_sgPinReel(\''+handle+'\','+rl.id+','+(rl.isPinned?'false':'true')+')" title="'+(rl.isPinned?'Unpin':'Pin to top')+'" style="cursor:pointer;font-size:14px;opacity:'+(rl.isPinned?'1':'.35')+'">\ud83d\udccc</span>'
          +'<span class="'+statusColor+' text-[10px] font-bold uppercase">'+rl.status+'</span></div>';
      }).join('');
    }).catch(function(){});
}

async function _loadCreatorEarnings(handle){
  try{
    var _period=window._cePeriod||'all';
    const res=await fetch('/api/referrals/earnings/'+encodeURIComponent(handle)+'?period='+_period);
    const data=await res.json();
    if(!data.success)return;
    
    const el=function(id){return document.getElementById(id);};
    if(el('ce-earnings'))el('ce-earnings').textContent=sgSymbol()+data.totalEarnings;
    if(el('ce-conversions'))el('ce-conversions').textContent=data.totalConversions;
    if(el('ce-clicks'))el('ce-clicks').textContent=data.totalClicks;
    if(el('ce-rate'))el('ce-rate').textContent=data.conversionRate+'%';
    
    // ═══ UPDATE DASHBOARD EXTRAS ═══
    var bookings=parseInt(data.totalConversions)||0;
    var earnings=parseFloat(data.totalEarnings)||0;
    
    // --- Creator Level ---
    var levels=[
      {name:'Starter',emoji:'🌱',min:0,color:'#94a3b8'},
      {name:'Rising Star',emoji:'⚡',min:5,color:'#38bdf8'},
      {name:'Hot Creator',emoji:'🔥',min:25,color:'#f97316'},
      {name:'Elite',emoji:'💎',min:100,color:'#a855f7'},
      {name:'Legend',emoji:'🏆',min:500,color:'#eab308'}
    ];
    var currentLevel=0;
    for(var li=levels.length-1;li>=0;li--){if(bookings>=levels[li].min){currentLevel=li;break;}}
    var lv=levels[currentLevel];
    if(el('ce-level-emoji'))el('ce-level-emoji').textContent=lv.emoji;
    if(el('ce-level-name'))el('ce-level-name').textContent=lv.name;
    if(el('ce-level-pill')){
      el('ce-level-pill').textContent='Level '+(currentLevel+1);
      el('ce-level-pill').style.background='rgba('+_hexToRgb(lv.color)+',.15)';
      el('ce-level-pill').style.color=lv.color;
    }
    if(el('ce-level-next')){
      if(currentLevel<levels.length-1){
        var next=levels[currentLevel+1];
        var remaining=next.min-bookings;
        el('ce-level-next').textContent=remaining+' more booking'+(remaining!==1?'s':'')+' to reach '+next.emoji+' '+next.name;
      }else{
        el('ce-level-next').textContent='You reached the highest level! 👑';
      }
    }
    // Update level checklist
    for(var ci=0;ci<levels.length;ci++){
      var checkEl=el('ce-level-check-'+ci);
      if(checkEl)checkEl.textContent=ci<=currentLevel?'✓':'○';
    }
    
    // --- Earnings Goal Bar ---
    var goalTiers=[10,25,50,100,250,500,1000,2500,5000];
    var currentGoal=goalTiers[0];
    for(var gi=0;gi<goalTiers.length;gi++){if(earnings<goalTiers[gi]){currentGoal=goalTiers[gi];break;}}
    if(earnings>=goalTiers[goalTiers.length-1])currentGoal=goalTiers[goalTiers.length-1];
    var prevGoal=0;
    for(var pi=goalTiers.indexOf(currentGoal)-1;pi>=0;pi--){if(earnings>=goalTiers[pi]){prevGoal=goalTiers[pi];break;}}
    var goalPct=Math.min(100,Math.round(((earnings-prevGoal)/(currentGoal-prevGoal))*100))||0;
    if(el('ce-goal-text'))el('ce-goal-text').textContent=sgSymbol()+earnings.toFixed(0)+' / '+sgSymbol()+currentGoal;
    if(el('ce-goal-fill'))el('ce-goal-fill').style.width=goalPct+'%';
    var remaining2=(currentGoal-earnings).toFixed(2);
    if(el('ce-goal-nudge')){
      if(earnings===0)el('ce-goal-nudge').textContent='Share your link to start earning!';
      else if(goalPct>=80)el('ce-goal-nudge').textContent='🔥 Almost there! Just '+sgSymbol()+remaining2+' to reach '+sgSymbol()+currentGoal+'!';
      else el('ce-goal-nudge').textContent=sgSymbol()+remaining2+' more to reach '+sgSymbol()+currentGoal;
    }
    
    // --- Next Action Nudge ---
    if(el('ce-nudge-title')&&el('ce-nudge-text')){
      if(bookings===0){
        el('ce-nudge-title').textContent='Get your first booking!';
        el('ce-nudge-text').textContent='Post your creator link on Instagram Stories — most creators get their first booking within 24 hours.';
      }else if(currentLevel<levels.length-1){
        var nxt=levels[currentLevel+1];
        var rem=nxt.min-bookings;
        el('ce-nudge-title').textContent='Unlock '+nxt.emoji+' '+nxt.name+'!';
        el('ce-nudge-text').textContent='Just '+rem+' more booking'+(rem!==1?'s':'')+' to level up. Share your link in a TikTok bio or YouTube description.';
      }else{
        el('ce-nudge-title').textContent='You\'re a Legend! 🏆';
        el('ce-nudge-text').textContent='Keep sharing — you\'re in the top tier of ScanGym creators worldwide.';
      }
    }
    
    // --- Milestone Celebration (confetti on level up) ---
    var storedLevel=parseInt(localStorage.getItem('sg_creator_level')||'0');
    if(currentLevel>storedLevel&&bookings>0){
      localStorage.setItem('sg_creator_level',String(currentLevel));
      _celebrateMilestone(lv.name,lv.emoji);
    }else if(storedLevel===0&&bookings===0){
      localStorage.setItem('sg_creator_level','0');
    }
    
    // Recent bookings
    const recentEl=el('ce-recent');
    if(recentEl){
      if(data.recentConversions.length===0){
        recentEl.innerHTML='<div class="bg-slate-800/40 rounded-lg p-4 text-center text-slate-500 text-sm">No bookings yet. Share your link to start earning!</div>';
      }else{
        recentEl.innerHTML=data.recentConversions.map(function(c){
          const d=new Date(c.convertedAt);
          const dateStr=d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
          return '<div class="bg-slate-800/60 rounded-lg p-3 flex items-center justify-between border border-slate-700/30"><div><p class="text-white text-sm font-medium">'+c.gymName+'</p><p class="text-slate-500 text-xs">'+dateStr+'</p></div><p class="text-brand font-bold">+£'+c.commission+'</p></div>';
        }).join('');
      }
    }
    
    // #56: Update conversion funnel
    var clicks=parseInt(data.totalClicks)||0;
    var conversions=parseInt(data.totalConversions)||0;
    var signups=parseInt(data.totalSignups||0);
    var funnelMax=Math.max(clicks,1);
    var felC=document.getElementById('ce-funnel-clicks');
    var felS=document.getElementById('ce-funnel-signups');
    var felB=document.getElementById('ce-funnel-bookings');
    if(felC)felC.style.width='100%';
    if(felS)felS.style.width=Math.round((signups/funnelMax)*100)+'%';
    if(felB)felB.style.width=Math.round((conversions/funnelMax)*100)+'%';
    var fnC=document.getElementById('ce-funnel-clicks-n');
    var fnS=document.getElementById('ce-funnel-signups-n');
    var fnB=document.getElementById('ce-funnel-bookings-n');
    if(fnC)fnC.textContent=clicks;
    if(fnS)fnS.textContent=signups;
    if(fnB)fnB.textContent=conversions;

    // #63: Update downloads & shares counts
    var dlEl=document.getElementById('ce-downloads');
    var shEl=document.getElementById('ce-shares');
    if(dlEl)dlEl.textContent=data.totalDownloads||'0';
    if(shEl)shEl.textContent=data.totalShares||'0';
    
    // #63: Update sparkline (7-day activity)
    var sparkEl=document.getElementById('ce-sparkline');
    if(sparkEl&&data.dailyClicks){
      var days=data.dailyClicks;
      var maxDay=Math.max.apply(null,days.map(function(d){return d.count;}))||1;
      sparkEl.innerHTML=days.map(function(d){
        var h=Math.max(10,Math.round((d.count/maxDay)*100));
        var color=d.count>0?'bg-brand':'bg-slate-700';
        return '<div class="flex-1 '+color+' rounded-t transition-all duration-500" style="height:'+h+'%" title="'+d.date+': '+d.count+' clicks"></div>';
      }).join('');
    }

    // ═══ Amazon-style: Per-channel analytics (load from new endpoint) ═══
    try{
      var chRes=await fetch('/api/referrals/channels/'+encodeURIComponent(handle));
      var chData=await chRes.json();
      var chanEl=document.getElementById('ce-channels');
      if(chanEl&&chData.success&&chData.channels.length>0){
        var channelIcons={tiktok:'🎵',instagram:'📸',youtube:'🎬',twitter:'🐦',facebook:'📘',snapchat:'👻',pinterest:'📌',linkedin:'💼',whatsapp:'💬',blog:'📝',email:'✉️',website:'🌐',direct:'🔗',other:'📎'};
        chanEl.innerHTML=chData.channels.map(function(ch){
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="font-size:18px">'+(channelIcons[ch.channel]||'📎')+'</span><div style="flex:1"><p style="color:#fff;font-size:13px;font-weight:600;text-transform:capitalize;margin:0">'+ch.channel+'</p><p style="color:rgba(255,255,255,.35);font-size:11px;margin:0">'+ch.clicks+' clicks · '+ch.conversions+' bookings · '+ch.conversionRate+'</p></div><span style="color:#4ade80;font-weight:700;font-size:13px">'+ch.earnings+'</span></div>';
        }).join('');
      }
    }catch(e){}

    // ═══ Load bounty earnings ═══
    try{
      var bRes=await fetch('/api/referrals/bounties/'+encodeURIComponent(handle));
      var bData=await bRes.json();
      var bEl=document.getElementById('ce-bounties');
      if(bEl&&bData.success){
        bEl.innerHTML='<span style="color:#4ade80;font-weight:700">'+bData.totalBounties+' signups</span><span style="color:rgba(255,255,255,.35)"> · </span><span style="color:#fff;font-weight:700">£'+(bData.totalEarningsPence/100).toFixed(2)+'</span><span style="color:rgba(255,255,255,.35)"> in bounties</span>';
      }
    }catch(e){}
  }catch(e){
    console.error('[Earnings] Load failed:',e);
  }
}

function CreatorDashboardPage(){
  var creatorData=JSON.parse(localStorage.getItem('sg_creator')||'null');
  var handle=creatorData?.handle||'';
  if(!handle){
    /* 1-Click Signup — TikTok full-screen style */
    return`<div style="position:relative;min-height:100vh;background:linear-gradient(180deg,#0a0a16 0%,#111127 50%,#0a0a16 100%);overflow:hidden">
      <!-- Background glow -->
      <div style="position:absolute;top:20%;left:50%;width:300px;height:300px;background:radial-gradient(circle,rgba(255,109,0,.15) 0%,transparent 70%);transform:translateX(-50%);pointer-events:none"></div>
      <!-- Content -->
      <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:40px 20px;text-align:center">
        <div style="width:80px;height:80px;background:linear-gradient(135deg,#FF6D00,#ff8534);border-radius:24px;display:flex;align-items:center;justify-content:center;font-size:36px;margin-bottom:20px;box-shadow:0 8px 32px rgba(255,109,0,.4)">🚀</div>
        <h1 style="color:#fff;font-size:28px;font-weight:900;line-height:1.2;margin-bottom:8px">Become a Creator</h1>
        <p style="color:rgba(255,255,255,.5);font-size:15px;margin-bottom:24px;max-width:280px">Earn 25% on every gym booking. Ready-made reels. Instant payouts.</p>
        <button onclick="window._sg1ClickCreatorSignup()" style="background:linear-gradient(135deg,#FF6D00,#ff8534);color:#fff;border:none;padding:18px 48px;border-radius:16px;font-size:18px;font-weight:800;cursor:pointer;box-shadow:0 8px 32px rgba(255,109,0,.4);animation:casinoGlow 2s ease-in-out infinite">⚡ 1-Click Signup</button>
        <p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:12px">Free forever · No credit card needed</p>
      </div>
      <!-- Stats preview at bottom -->
      <div style="position:absolute;bottom:80px;left:16px;right:16px;display:flex;gap:8px">
        <div style="flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px;text-align:center">
          <p style="color:#FF6D00;font-size:20px;font-weight:900">25%</p><p style="color:rgba(255,255,255,.3);font-size:10px">Commission</p>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px;text-align:center">
          <p style="color:#4ade80;font-size:20px;font-weight:900">⚡</p><p style="color:rgba(255,255,255,.3);font-size:10px">Instant Payout</p>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px;text-align:center">
          <p style="color:#3b82f6;font-size:20px;font-weight:900">242+</p><p style="color:rgba(255,255,255,.3);font-size:10px">Ready Reels</p>
        </div>
      </div>
    </div>`;
  }
  setTimeout(function(){_loadCreatorDash(handle);_sgStartBookingAlerts(handle);},200);
  var link='scangym.com/r/'+handle;
  /* TikTok full-screen creator dashboard */
  return`<div style="position:relative;min-height:100vh;background:#0a0a16;overflow-y:auto;padding-bottom:80px">
    <!-- Background gradient -->
    <div style="position:fixed;top:0;left:0;right:0;height:300px;background:linear-gradient(180deg,rgba(255,109,0,.06) 0%,transparent 100%);pointer-events:none;z-index:0"></div>

    <!-- Right-side TikTok buttons (fixed) -->
    <div style="position:fixed;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:14px;z-index:20;align-items:center;max-height:82vh;overflow-y:auto;scrollbar-width:none">
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgCopyAffiliateLink('${handle}')">
        <div style="width:48px;height:48px;background:rgba(255,109,0,.15);border:1px solid rgba(255,109,0,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">📋</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Copy Link</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgCreatorWithdraw('${handle}')">
        <div style="width:48px;height:48px;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">💸</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Withdraw</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="window._sgCreatorFilterReels&&_sgCreatorFilterReels('trending')">
        <div style="width:48px;height:48px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">🔥</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Trending</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="window._sgCreatorFilterReels&&_sgCreatorFilterReels('not-downloaded')">
        <div style="width:48px;height:48px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">⬇️</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">New</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_creatorGetLink()">
        <div style="width:48px;height:48px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">🔗</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Deep Link</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="sgToast('Live streaming coming soon! 🔴','info')">
        <div style="width:48px;height:48px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">📡</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Go Live</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="navigate('/creator-earnings')">
        <div style="width:48px;height:48px;background:rgba(56,189,248,.15);border:1px solid rgba(56,189,248,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\udcca</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Analytics</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgCreatorTierSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(255,109,0,.15);border:1px solid rgba(255,109,0,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udfaf</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Tiers</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgCreatorLeaderboardSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udfc6</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Board</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="navigate('/upload')">
        <div style="width:48px;height:48px;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udfac</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Upload</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgCreatorPageSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udfa8</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">My Page</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgMassShareSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\udce3</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Share All</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgScheduleShareSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(56,189,248,.15);border:1px solid rgba(56,189,248,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\udcc5</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Schedule</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgNotifyFollowersSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\udd14</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Notify</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgGiveawaySheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(236,72,153,.15);border:1px solid rgba(236,72,153,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udf81</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Giveaway</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgBoostSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(255,109,0,.15);border:1px solid rgba(255,109,0,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\ude80</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Boost</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgBundleSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83c\udff7\ufe0f</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Bundle</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgClipStudioSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\u2702\ufe0f</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Clip</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="_sgFanInboxSheet('${handle}')">
        <div style="width:48px;height:48px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px)">\ud83d\udcac</div>
        <span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:600">Fans</span>
      </div>
    </div>

    <!-- Stats overlay (top) -->
    <div style="position:relative;z-index:2;padding:16px 16px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div onclick="navigate('/more')" style="cursor:pointer;color:rgba(255,255,255,.6);font-size:14px;font-weight:600">← Back</div>
        <p style="color:#fff;font-size:16px;font-weight:800">🚀 Creator Hub</p>
        <div style="width:40px"></div>
      </div>
      <!-- Stats row -->
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <div style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 8px;text-align:center">
          <p id="cd-clicks" style="color:#fff;font-size:22px;font-weight:900">—</p><p style="color:rgba(255,255,255,.3);font-size:10px">Clicks</p>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 8px;text-align:center">
          <p id="cd-conversions" style="color:#fff;font-size:22px;font-weight:900">—</p><p style="color:rgba(255,255,255,.3);font-size:10px">Conversions</p>
        </div>
        <div style="flex:1;background:rgba(255,109,0,.08);border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:12px 8px;text-align:center">
          <p id="cd-earnings" style="color:#FF6D00;font-size:22px;font-weight:900">—</p><p style="color:rgba(255,255,255,.3);font-size:10px">Earnings</p>
        </div>
        <div style="flex:1;background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.15);border-radius:14px;padding:12px 8px;text-align:center">
          <p id="cd-balance" style="color:#4ade80;font-size:22px;font-weight:900">—</p><p style="color:rgba(255,255,255,.3);font-size:10px">Balance</p>
        </div>
      </div>
    </div>

    <!-- R7-A02: Payout Setup Banner -->
    <div id="cd-payout-banner" style="display:none;margin:0 16px 12px;background:linear-gradient(135deg,rgba(168,85,247,.1),rgba(59,130,246,.06));border:1px solid rgba(168,85,247,.2);border-radius:14px;padding:14px;text-align:center">
      <p style="font-size:20px;margin-bottom:4px">🏦</p>
      <p style="color:#fff;font-size:14px;font-weight:700;margin-bottom:2px">Withdraw Earnings</p>
      <p style="color:rgba(255,255,255,.35);font-size:11px;margin-bottom:10px">Your earnings are in your ScanGym Wallet — withdraw to bank anytime</p>
      <button onclick="navigate('/wallet')" style="background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer">Go to Wallet →</button>
    </div>

    <!-- R7-A03: Affiliate Link Card -->
    <div style="margin:0 16px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <p style="color:#fff;font-size:13px;font-weight:700">🔗 Your Affiliate Link</p>
        <div id="cd-payout-status" style="display:flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(239,68,68,.1);border-radius:6px">
          <div style="width:6px;height:6px;border-radius:50%;background:#ef4444"></div>
          <span style="color:#f87171;font-size:9px;font-weight:600">No Payout Set</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <div style="flex:1;background:rgba(255,109,0,.05);border:1px solid rgba(255,109,0,.15);border-radius:10px;padding:10px 12px;overflow:hidden">
          <p id="cd-affiliate-url" style="color:#FF6D00;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">scangym.com/r/${handle}</p>
        </div>
        <button onclick="_sgCopyAffiliateLink('${handle}')" style="background:#FF6D00;color:#fff;border:none;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">📋 Copy</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="_sgShareAffiliate('${handle}','whatsapp')" style="flex:1;background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.15);color:#25d366;padding:8px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">WhatsApp</button>
        <button onclick="_sgShareAffiliate('${handle}','twitter')" style="flex:1;background:rgba(29,161,242,.08);border:1px solid rgba(29,161,242,.15);color:#1da1f2;padding:8px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">Twitter/X</button>
        <button onclick="_sgShareAffiliate('${handle}','native')" style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.6);padding:8px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer">📤 Share</button>
      </div>
    </div>

    <!-- R7-A04: Quick Withdraw on Hub -->
    <div style="margin:0 16px 12px;background:rgba(74,222,128,.04);border:1px solid rgba(74,222,128,.1);border-radius:14px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <p style="color:rgba(255,255,255,.4);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Available to Withdraw</p>
          <p id="cd-withdraw-amount" style="color:#4ade80;font-size:24px;font-weight:900;margin:2px 0 0">£0.00</p>
        </div>
        <button id="cd-withdraw-btn" onclick="_sgCreatorWithdraw('${handle}')" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer">Withdraw →</button>
      </div>
      <p style="color:rgba(255,255,255,.25);font-size:10px">Min. £5 · Instant to wallet · 1-3 days to bank</p>
    </div>

    <!-- R7-A07: Recent Activity Feed -->
    <div style="margin:0 16px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <p style="color:#fff;font-size:13px;font-weight:700">⚡ Recent Activity</p>
        <span style="color:rgba(255,255,255,.2);font-size:10px">Live</span>
      </div>
      <div id="cd-activity-feed" style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">
        <p style="color:rgba(255,255,255,.2);font-size:11px;text-align:center;padding:12px">Loading activity...</p>
      </div>
    </div>

    <!-- Reels Filter pills -->
    <div style="padding:0 16px 12px;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch" id="cd-filter-bar">
      <div class="sg-filter-pill active" onclick="_sgCreatorFilterReels('all',this)" data-cf="all">All</div>
      <div class="sg-filter-pill" onclick="_sgCreatorFilterReels('not-downloaded',this)" data-cf="not-downloaded">⬇️ Not Downloaded</div>
      <div class="sg-filter-pill" onclick="_sgCreatorFilterReels('not-shared',this)" data-cf="not-shared">📤 Not Shared</div>
      <div class="sg-filter-pill" onclick="_sgCreatorFilterReels('trending',this)" data-cf="trending">🔥 Trending</div>
      <div class="sg-filter-pill" onclick="_sgCreatorFilterReels('most-viewed',this)" data-cf="most-viewed">👁️ Most Viewed</div>
      <div class="sg-filter-pill" onclick="_sgCreatorFilterReels('latest',this)" data-cf="latest">🆕 Latest</div>
    </div>

    <!-- Ready-made Reels grid -->
    <div style="padding:0 16px">
      <div id="cd-reels-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <p style="color:rgba(255,255,255,.3);grid-column:span 3;text-align:center;padding:40px">Loading reels...</p>
      </div>
    </div>

    <!-- Trending section -->
    <div style="padding:16px">
      <p style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🔥 Trending Now</p>
      <div id="cd-trending" style="display:flex;flex-direction:column;gap:8px">
        <p style="color:rgba(255,255,255,.3);text-align:center;padding:20px">Loading...</p>
      </div>
    </div>
  </div>`;
}

window._sg1ClickCreatorSignup=async function(){
  var u=state.user;
  if(!u){navigate('/login');sgToast('Log in first to become a creator','info');return;}
  var handle=(u.name||u.phone||'creator').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,15)||'creator'+Math.floor(Math.random()*9999);
  try{
    var joinResp=await fetch('/api/creators/join',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include'}).then(function(r){return r.json();}).catch(function(){return {};});
    var linkResp=await fetch('/api/referrals/generate-link',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({handle:handle})}).then(function(r){return r.json();}).catch(function(){return {};});
    var finalHandle=linkResp.handle||handle;
    var creatorData={handle:finalHandle,name:u.name||'Creator',joined:new Date().toISOString(),tier:(joinResp.tier&&joinResp.tier.name)||'Starter',serverSynced:true};
    localStorage.setItem('sg_creator',JSON.stringify(creatorData));
    if(state.user)state.user.referral_code=finalHandle;
    fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:finalHandle})}).catch(function(){});
    sgToast('\u{1F389} Welcome to ScanSquad, '+finalHandle+'!','success',3000);
  }catch(e){
    var creatorData2={handle:handle,name:u.name||'Creator',joined:new Date().toISOString(),tier:'Starter'};
    localStorage.setItem('sg_creator',JSON.stringify(creatorData2));
    if(state.user)state.user.referral_code=handle;
    fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:handle})}).catch(function(){});
    sgToast('\u{1F389} Welcome to ScanSquad, '+handle+'!','success',3000);
  }
  navigate('/creator-hub');
  setTimeout(function(){_sgShowCreatorOnboarding(finalHandle||handle);},600);
};

window._sgShowCreatorOnboarding=function(handle){
  var o=document.createElement('div');o.id='sg-creator-onboard';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  var h='<div style="background:#111;border:1px solid rgba(255,255,255,.1);border-radius:20px;max-width:380px;width:100%;padding:24px;text-align:center">';
  h+='<div id="sg-ob-s1"><p style="font-size:40px;margin-bottom:12px">\ud83c\udf89</p>';
  h+='<h2 style="color:#fff;font-size:22px;font-weight:900;margin-bottom:6px">Welcome to ScanSquad!</h2>';
  h+='<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">You\u2019re now a creator. 3 quick steps to get started.</p>';
  h+='<div style="display:flex;gap:6px;margin-bottom:20px"><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.1)"></div><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.1)"></div></div>';
  h+='<button onclick="_sgObStep(2)" style="width:100%;background:#FF6D00;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer">Next: Set Up Payouts \u2192</button></div>';
  h+='<div id="sg-ob-s2" style="display:none"><p style="font-size:40px;margin-bottom:12px">\ud83c\udfe6</p>';
  h+='<h2 style="color:#fff;font-size:20px;font-weight:900;margin-bottom:6px">Your Wallet</h2>';
  h+='<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:16px">Earnings go straight to your ScanGym Wallet — withdraw to bank anytime.</p>';
  h+='<div style="display:flex;gap:6px;margin-bottom:16px"><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.1)"></div></div>';
  h+='<button onclick="document.getElementById(\'sg-creator-onboard\').remove();navigate(\'/wallet\')" style="width:100%;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px">Go to Wallet \u2192</button>';
  h+='<button onclick="_sgObStep(3)" style="width:100%;background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08);padding:10px;border-radius:10px;font-size:12px;cursor:pointer">Skip for now</button></div>';
  h+='<div id="sg-ob-s3" style="display:none"><p style="font-size:40px;margin-bottom:12px">\ud83d\udd17</p>';
  h+='<h2 style="color:#fff;font-size:20px;font-weight:900;margin-bottom:6px">Share Your Link</h2>';
  h+='<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:12px">Your unique affiliate link is ready:</p>';
  h+='<div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.15);border-radius:10px;padding:12px;margin-bottom:16px"><p style="color:#FF6D00;font-size:14px;font-weight:700">scangym.com/r/'+handle+'</p></div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:16px"><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div><div style="flex:1;height:4px;border-radius:2px;background:#FF6D00"></div></div>';
  h+='<button onclick="_sgCopyAffiliateLink(\''+handle+'\');document.getElementById(\'sg-creator-onboard\').remove()" style="width:100%;background:#FF6D00;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer">\ud83d\udccb Copy Link & Start Earning</button></div></div>';
  o.innerHTML=h;document.body.appendChild(o);
};

window._sgCreatorDeepLink=function(){
  var u=state&&state.user;
  if(!u){
    sgToast('Sign in to get deep affiliate links','info',2000);
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}else{navigate('/login');}
    return;
  }
  var refCode=u.referral_code;
  if(!refCode){try{var c=JSON.parse(localStorage.getItem('sg_creator')||'null');if(c&&c.handle)refCode=c.handle;}catch(e){}}
  if(!refCode&&u.referralHandle)refCode=u.referralHandle;
  if(!refCode){sgToast('Could not find your affiliate handle — try re-logging in','error',3000);return;}

  _sgOpenSheet('sg-deep-link-sheet',
    '<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">\ud83c\udfaf Deep Affiliate Link</h2>'
    +'<p style="color:rgba(255,255,255,.45);font-size:12px;margin:0 0 16px;line-height:1.4">Paste any <strong style="color:#FF6D00">ScanGym.com</strong> page link below. Your referral code is added automatically \u2014 you earn 25% on every booking!</p>'
    +'<div style="position:relative;margin-bottom:12px">'
    +'<input id="sg-deep-url" type="url" placeholder="Paste any scangym.com link\u2026" oninput="_sgDeepGenerate(this.value)" autocomplete="off" style="width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:14px;outline:none">'
    +'</div>'
    +'<div id="sg-deep-preview" style="margin-bottom:12px"></div>'
    +'<div id="sg-deep-link-result" style="display:none">'
    +'<div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.2);border-radius:12px;padding:14px">'
    +'<p style="color:rgba(255,255,255,.5);font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin:0 0 4px">Your Deep Affiliate Link</p>'
    +'<p id="sg-deep-link-url" style="color:#FF6D00;font-size:13px;font-weight:700;font-family:monospace;word-break:break-all;margin:0 0 10px"></p>'
    +'<button id="sg-deep-copy" onclick="_sgDeepCopyLink()" style="width:100%;background:#FF6D00;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 4px 16px rgba(255,109,0,.3)">\ud83d\udccb Click to Copy</button>'
    +'</div></div>'
    +'<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;margin-top:12px">'
    +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:0;line-height:1.5">\ud83d\udca1 <strong style="color:rgba(255,255,255,.6)">Tip:</strong> Browse scangym.com, find any page (gym, booking, city, etc.), copy the URL from the address bar, and paste it here.</p>'
    +'</div>'
  );
  setTimeout(function(){var el=document.getElementById('sg-deep-url');if(el)el.focus();},300);
};

window._sgCreatorFilterReels=function(filter,el){
  if(el){
    document.querySelectorAll('#cd-filter-bar .sg-filter-pill').forEach(function(p){p.classList.remove('active');});
    el.classList.add('active');
  }
  var grid=document.getElementById('cd-reels-grid');
  if(!grid)return;
  var reels=grid.querySelectorAll('[data-reel-card]');
  var downloaded=JSON.parse(localStorage.getItem('sg_creator_downloaded')||'[]');
  var shared=JSON.parse(localStorage.getItem('sg_creator_shared')||'[]');
  reels.forEach(function(card){
    var id=card.getAttribute('data-reel-id');
    var show=true;
    if(filter==='not-downloaded'&&downloaded.indexOf(id)>=0)show=false;
    if(filter==='not-shared'&&shared.indexOf(id)>=0)show=false;
    card.style.display=show?'':'none';
  });
  if(filter==='trending'||filter==='most-viewed'||filter==='latest'){
    /* Re-sort: move matching to top visually via order */
    var arr=Array.from(reels);
    arr.sort(function(a,b){
      if(filter==='trending')return(parseInt(b.getAttribute('data-views'))||0)-(parseInt(a.getAttribute('data-views'))||0);
      if(filter==='most-viewed')return(parseInt(b.getAttribute('data-views'))||0)-(parseInt(a.getAttribute('data-views'))||0);
      if(filter==='latest')return(parseInt(b.getAttribute('data-idx'))||0)-(parseInt(a.getAttribute('data-idx'))||0);
      return 0;
    });
    arr.forEach(function(card,i){card.style.order=i;card.style.display='';});
  }
};

window._sgCreatorDownloadReel=function(reelId,url){
  var d=JSON.parse(localStorage.getItem('sg_creator_downloaded')||'[]');
  if(d.indexOf(reelId)<0){d.push(reelId);localStorage.setItem('sg_creator_downloaded',JSON.stringify(d));}
  if(url)window.open(url,'_blank');
  sgToast('Downloaded! Share it with your affiliate link baked in \u{1F680}','success',2000);
};

window._sgCreatorShareReel=function(reelId){
  var s=JSON.parse(localStorage.getItem('sg_creator_shared')||'[]');
  if(s.indexOf(reelId)<0){s.push(reelId);localStorage.setItem('sg_creator_shared',JSON.stringify(s));}
  var creatorData=JSON.parse(localStorage.getItem('sg_creator')||'{}');
  var link='https://scangym.com/r/'+(creatorData.handle||'creator');
  if(navigator.share){navigator.share({title:'Check out ScanGym!',text:'Day passes from '+sgPriceDisplay('day'),url:link}).catch(function(){});}
  else{navigator.clipboard.writeText(link);sgToast('Affiliate link copied! \u{1F4CB}','success',2000);}
};

window._loadCreatorDash=async function(handle){
  try{
    var r=await fetch('/api/referrals/stats/'+handle);
    var d=await r.json();
    var sym=(typeof sgSymbol==='function')?sgSymbol():'£';
    document.getElementById('cd-clicks').textContent=d.clicks||0;
    document.getElementById('cd-conversions').textContent=d.conversions||0;
    document.getElementById('cd-earnings').textContent=sym+((d.earnings_pence||0)/100).toFixed(2);
    document.getElementById('cd-balance').textContent=sym+((d.available_pence||d.earnings_pence||0)/100).toFixed(2);
    // R7: Update hub cards
    var wdAmt=document.getElementById('cd-withdraw-amount');
    if(wdAmt)wdAmt.textContent=sym+((d.available_pence||d.earnings_pence||0)/100).toFixed(2);
    var wdBtn=document.getElementById('cd-withdraw-btn');
    if(wdBtn&&(d.available_pence||0)<500){wdBtn.style.opacity='.5';}
    var payBanner=document.getElementById('cd-payout-banner');
    if(payBanner){payBanner.style.display=d.hasPayoutMethod?'none':'block';}
    var payStatus=document.getElementById('cd-payout-status');
    if(payStatus&&d.hasPayoutMethod){payStatus.innerHTML='<div style="width:6px;height:6px;border-radius:50%;background:#22c55e"></div><span style="color:#4ade80;font-size:9px;font-weight:600">Payout Ready</span>';payStatus.style.background='rgba(34,197,94,.1)';}
  }catch(e){}
  // R7-A07: Load activity feed
  try{
    var af=await fetch('/api/referrals/activity/'+handle);var ad=await af.json();
    var feedEl=document.getElementById('cd-activity-feed');
    if(feedEl&&ad.activities&&ad.activities.length){
      feedEl.innerHTML=ad.activities.slice(0,8).map(function(a){
        var icons={click:'\ud83d\udc41\ufe0f',signup:'\ud83d\udc64',conversion:'\ud83d\udcb0',download:'\u2b07\ufe0f',share:'\ud83d\udce4',bounty:'\ud83c\udfaf'};
        var colors={click:'rgba(59,130,246,.7)',signup:'rgba(168,85,247,.7)',conversion:'#FF6D00',download:'rgba(255,255,255,.4)',share:'rgba(255,255,255,.4)',bounty:'rgba(34,197,94,.7)'};
        var icon=icons[a.type]||'\u26a1';var color=colors[a.type]||'rgba(255,255,255,.4)';
        var ago=_sgTimeAgo(a.created_at);
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,.02);border-radius:8px">'
          +'<span style="font-size:12px">'+icon+'</span>'
          +'<span style="flex:1;color:'+color+';font-size:11px;font-weight:500">'+a.description+'</span>'
          +'<span style="color:rgba(255,255,255,.15);font-size:9px;white-space:nowrap">'+ago+'</span></div>';
      }).join('');
    }else if(feedEl){feedEl.innerHTML='<p style="color:rgba(255,255,255,.2);font-size:11px;text-align:center;padding:12px">Share your link to see activity here</p>';}
  }catch(e){}
  // Load reels
  try{
    var rr=await fetch('/api/reels/feed?limit=6');
    var rd=await rr.json();
    var grid=document.getElementById('cd-reels-grid');if(!grid)return;
    var reels=rd.reels||rd.feed||rd||[];
    if(!reels.length){grid.innerHTML='<p style="color:rgba(255,255,255,.3);grid-column:span 2;text-align:center">No reels available yet</p>';return;}
    grid.innerHTML=reels.slice(0,6).map(function(reel){
      var thumb=reel.thumbnail_url||reel.video_url||'';
      return'<div style="position:relative;aspect-ratio:9/16;background:rgba(255,255,255,.05);border-radius:12px;overflow:hidden;cursor:pointer" onclick="sgToast(\'Download coming soon!\',\'info\')">'
        +(thumb?'<img src="'+thumb+'" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">':'')
        +'<div style="position:absolute;bottom:0;left:0;right:0;padding:8px;background:linear-gradient(transparent,rgba(0,0,0,.8))"><p style="color:#fff;font-size:11px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(reel.caption||reel.title||'Gym Reel')+'</p>'
        +'<p style="color:rgba(255,255,255,.4);font-size:10px;margin:2px 0 0">'+(reel.views||0)+' views</p></div></div>';
    }).join('');
  }catch(e){}
  // Load trending
  try{
    var tr=await fetch('/api/reels/feed?limit=5&sort=trending');
    var td=await tr.json();
    var trending=document.getElementById('cd-trending');if(!trending)return;
    var treels=td.reels||td.feed||td||[];
    if(!treels.length){trending.innerHTML='<p style="color:rgba(255,255,255,.3);text-align:center">No trending reels yet</p>';return;}
    trending.innerHTML=treels.slice(0,5).map(function(reel,i){
      return'<div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px">'
        +'<span style="color:rgba(255,255,255,.2);font-size:18px;font-weight:900;width:24px;text-align:center">'+(i+1)+'</span>'
        +'<div style="flex:1"><p style="color:#fff;font-size:13px;font-weight:600;margin:0">'+(reel.caption||'Gym Reel')+'</p>'
        +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">'+(reel.views||0)+' views · '+(reel.likes||0)+' likes</p></div>'
        +'<span style="color:#FF6D00;font-size:12px;font-weight:700">🔥</span></div>';
    }).join('');
  }catch(e){}
};

function CreatorSignedOutPage(){
  var commission=(typeof sgCommissionRange==='function')?sgCommissionRange():'';
  var signIn="(typeof window._sgShowAuthSheet==='function'?window._sgShowAuthSheet('creator'):navigate('/login'))";
  var facts=[
    {icon:'\uD83D\uDCB0',title:'25% commission',desc:'On every booking made through your link'+(commission?' ('+commission+' each)':'')+'. No caps.'},
    {icon:'\uD83D\uDD17',title:'Your own referral link',desc:'A 30-day cookie tracks anyone who clicks it \u2014 they don\u2019t have to book straight away.'},
    {icon:'\uD83D\uDCC5',title:'Weekly payouts',desc:'Withdraw whenever you like. Free to join, no minimum follower count.'}
  ].map(function(f){
    return '<div style="display:flex;gap:12px;align-items:flex-start;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px">'
      +'<div style="font-size:20px;line-height:1;flex-shrink:0">'+f.icon+'</div>'
      +'<div><div style="color:#fff;font-size:14px;font-weight:700;margin-bottom:2px">'+f.title+'</div>'
      +'<div style="color:rgba(255,255,255,.45);font-size:12px;line-height:1.45">'+f.desc+'</div></div></div>';
  }).join('');
  return '<div style="position:fixed;top:0;left:0;right:0;bottom:56px;background:#0a0a16;overflow-y:auto;-webkit-overflow-scrolling:touch">'
    +'<div style="max-width:480px;margin:0 auto;padding:28px 20px 32px">'
      +'<div style="display:inline-block;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);color:#a855f7;font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:5px 10px;border-radius:999px;margin-bottom:14px">ScanSquad</div>'
      +'<h1 style="color:#fff;font-size:26px;line-height:1.2;font-weight:900;margin:0 0 8px">Get paid to share gyms you already love.</h1>'
      +'<p style="color:rgba(255,255,255,.5);font-size:14px;line-height:1.5;margin:0 0 22px">ScanGym\u2019s creator programme. Share a link, earn a cut of every day pass booked through it.</p>'
      +'<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">'+facts+'</div>'
      +'<button onclick="'+signIn+'" style="width:100%;background:linear-gradient(135deg,#a855f7,#FF6D00);color:#fff;border:none;padding:16px;border-radius:14px;font-weight:800;font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent">Join ScanSquad \u2014 it\u2019s free</button>'
      +'<div onclick="navigate(\'/scansquad\')" style="text-align:center;color:rgba(255,255,255,.4);font-size:13px;margin-top:14px;cursor:pointer;padding:8px">See how it works \u2192</div>'
    +'</div></div>';
}

function CreatorFullPage(){
  var u=state&&state.user;
  // Signed-out visitors used to fall through to the dashboard below, which then
  // rendered "Hey, ScanSquad", a placeholder referral link (scangym.com/r/creator123)
  // and a grid of "—" metrics — i.e. a logged-in creator dashboard belonging to
  // nobody. It read as broken/fake to anyone landing on the tab. Show them what
  // ScanSquad actually is and one way in instead.
  if(!u) return CreatorSignedOutPage();
  var name=u.full_name||u.email||'ScanSquad';
  var refCode=u.referral_code||'creator123';
  var refLink='scangym.com/r/'+refCode;
  var firstName=name.split(' ')[0];
  return `<div style="position:fixed;top:0;left:0;right:0;bottom:56px;background:#0a0a16;display:flex;flex-direction:column;overflow:hidden">
    <!-- Side nav buttons (3 core flow + More) -->
    <div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;z-index:10">
      <!-- 1. Sign In -->
      <div onclick="${u?'sgToast(\'Already signed in ✅\',\'success\',1500)':'(typeof window._sgShowAuthSheet===\'function\'?window._sgShowAuthSheet(\'book\'):navigate(\'/login\'))'};_closeCreatorMore()" class="creator-side-btn" style="width:42px;height:42px;background:${u?'rgba(34,197,94,.2)':'rgba(255,109,0,.25)'};backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border:1px solid ${u?'rgba(34,197,94,.3)':'rgba(255,109,0,.4)'};transition:.2s;box-shadow:0 0 16px ${u?'rgba(34,197,94,.15)':'rgba(255,109,0,.2)'}" title="Sign In">${u?'\u2705':'\ud83d\udd11'}</div>
      <!-- 2. Get Affiliate Link -->
      <div onclick="_creatorGetLink();_closeCreatorMore()" class="creator-side-btn" style="width:42px;height:42px;background:rgba(168,85,247,.2);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border:1px solid rgba(168,85,247,.3);transition:.2s;box-shadow:0 0 12px rgba(168,85,247,.15)" title="Get Affiliate Link">\ud83d\udd17</div>
      <!-- 3. Withdraw Money -->
      <div onclick="_creatorWithdraw();_closeCreatorMore()" class="creator-side-btn" style="width:42px;height:42px;background:rgba(34,197,94,.15);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border:1px solid rgba(34,197,94,.2);transition:.2s;box-shadow:0 0 12px rgba(34,197,94,.1)" title="Withdraw Money">\ud83d\udcb8</div>
      <!-- 4. Deep Affiliate Link (gym-specific) -->
      <div onclick="_sgCreatorDeepLink();_closeCreatorMore()" class="creator-side-btn" style="width:42px;height:42px;background:rgba(255,109,0,.2);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border:1px solid rgba(255,109,0,.3);transition:.2s;box-shadow:0 0 12px rgba(255,109,0,.15)" title="Deep Affiliate Link">\ud83c\udfaf</div>
      <!-- 5. More -->
      <div onclick="_toggleCreatorMore()" class="creator-side-btn" id="creator-more-btn" style="width:42px;height:42px;background:rgba(255,255,255,.08);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;letter-spacing:2px;border:1px solid rgba(255,255,255,.06);transition:.2s;color:rgba(255,255,255,.6)" title="More">\u2022\u2022\u2022</div>
    </div>
    <!-- More dropdown menu -->
    <div id="creator-more-menu" style="display:none;position:absolute;right:58px;top:50%;transform:translateY(-50%);z-index:11;background:rgba(15,15,30,.95);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
      <div onclick="_showCreatorScreen(0);_closeCreatorMore()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">\ud83c\udfe0</span><span style="color:#fff;font-size:13px;font-weight:600">Home</span>
      </div>
      <div onclick="_showCreatorScreen(1);_closeCreatorMore()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">\ud83d\udcca</span><span style="color:#fff;font-size:13px;font-weight:600">Analytics</span>
      </div>
      <div onclick="_showCreatorScreen(2);_closeCreatorMore()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">\ud83d\udcf9</span><span style="color:#fff;font-size:13px;font-weight:600">Content</span>
      </div>
      <div onclick="_showCreatorScreen(4);_closeCreatorMore()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">\ud83c\udfe0</span><span style="color:#fff;font-size:13px;font-weight:600">Storefront</span>
      </div>
      <div onclick="_showCreatorScreen(5);_closeCreatorMore()" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:.15s" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">\ud83c\udfa8</span><span style="color:#fff;font-size:13px;font-weight:600">Assets</span>
      </div>
    </div>
    <!-- Screen 0: HOME \u2014 Percentile Ranking (OnlyFans) + Live Stats (Grab) + Bounty (Amazon) -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#FF6D00,#E66200);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff">${firstName[0]}</div>
        <div>
          <h1 style="font-size:20px;font-weight:900;color:#fff;margin:0">Hey, ${firstName} \ud83d\udc4b</h1>
          <p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">ScanSquad since ${new Date().toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</p>
        </div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(168,85,247,.12),rgba(255,109,0,.08));border:1px solid rgba(168,85,247,.2);border-radius:16px;padding:14px;margin-bottom:12px;text-align:center">
        <div style="color:rgba(255,255,255,.5);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">YOUR RANKING</div>
        <div id="cf-ranking" style="font-size:32px;font-weight:900;background:linear-gradient(135deg,#a855f7,#FF6D00);-webkit-background-clip:text;-webkit-text-fill-color:transparent">—</div>
        <div style="color:rgba(255,255,255,.4);font-size:10px;margin-top:2px">of all ScanGym creators this month</div>
        <div style="width:100%;height:4px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:8px;overflow:hidden"><div style="width:85%;height:100%;background:linear-gradient(90deg,#a855f7,#FF6D00);border-radius:2px"></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:12px">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:8px;text-align:center"><div id="cf-reels" style="font-size:18px;font-weight:900;color:#a855f7">—</div><div style="font-size:7px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Reels</div></div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:8px;text-align:center"><div id="cf-clicks" style="font-size:18px;font-weight:900;color:#FF6D00">—</div><div style="font-size:7px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Clicks</div></div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:8px;text-align:center"><div id="cf-bookings" style="font-size:18px;font-weight:900;color:#22c55e">—</div><div style="font-size:7px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Bookings</div></div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:8px;text-align:center"><div id="cf-earned" style="font-size:18px;font-weight:900;color:#22c55e">—</div><div style="font-size:7px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Earned</div></div>
      </div>
      <div style="background:linear-gradient(135deg,rgba(255,109,0,.08),rgba(255,109,0,.02));border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="color:#FF6D00;font-size:11px;font-weight:700">\ud83c\udfaf BOUNTY ACTIVE</span>
          <span style="color:rgba(255,255,255,.4);font-size:9px">Ends in 5 days</span>
        </div>
        <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:2px">Refer 3 new gym-goers = \u00a310 bonus</div>
        <div style="color:rgba(255,255,255,.35);font-size:10px;margin-bottom:6px">Progress: 1/3 completed</div>
        <div style="width:100%;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="width:33%;height:100%;background:#FF6D00;border-radius:3px"></div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px 12px;margin-bottom:10px">
        <code style="flex:1;color:#a855f7;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${refLink}</code>
        <button onclick="navigator.clipboard.writeText('https://${refLink}');this.textContent='\u2713';setTimeout(()=>this.textContent='Copy',1500)" style="background:#a855f7;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-weight:700;font-size:11px;cursor:pointer">Copy</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="navigator.share?navigator.share({title:'ScanGym',url:'https://${refLink}'}):navigator.clipboard.writeText('https://${refLink}')" style="flex:1;background:#a855f7;color:#fff;border:none;padding:12px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer">\ud83d\udce4 Share</button>
      </div>
    </div>
    <!-- Screen 1: ANALYTICS -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:none;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">\ud83d\udcca Analytics</h2>
      <p style="color:rgba(255,255,255,.4);font-size:11px;margin-bottom:14px">Real-time performance data</p>
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px">
        <div style="color:rgba(255,255,255,.4);font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">EARNINGS BY SOURCE</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;background:#FF6D00;border-radius:2px;flex-shrink:0"></div><span style="flex:1;color:#fff;font-size:11px">Referral Links</span><span id="cf-src-referral" style="color:#22c55e;font-size:11px;font-weight:700">—</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;background:#a855f7;border-radius:2px;flex-shrink:0"></div><span style="flex:1;color:#fff;font-size:11px">Reel Conversions</span><span id="cf-src-reels" style="color:#22c55e;font-size:11px;font-weight:700">—</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:8px;height:8px;background:#3b82f6;border-radius:2px;flex-shrink:0"></div><span style="flex:1;color:#fff;font-size:11px">QR Code Scans</span><span id="cf-src-qr" style="color:#22c55e;font-size:11px;font-weight:700">—</span></div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:rgba(255,255,255,.4);font-size:9px;text-transform:uppercase;letter-spacing:.5px">TODAY (LIVE)</span>
          <span style="color:#22c55e;font-size:9px;font-weight:600">\u25cf Updated just now</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div style="text-align:center"><div id="cf-today-clicks" style="color:#FF6D00;font-size:16px;font-weight:800">—</div><div style="color:rgba(255,255,255,.3);font-size:8px">Clicks</div></div>
          <div style="text-align:center"><div id="cf-today-orders" style="color:#22c55e;font-size:16px;font-weight:800">—</div><div style="color:rgba(255,255,255,.3);font-size:8px">Orders</div></div>
          <div style="text-align:center"><div id="cf-today-rate" style="color:#a855f7;font-size:16px;font-weight:800">—</div><div style="color:rgba(255,255,255,.3);font-size:8px">Conv Rate</div></div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px">
        <div style="color:rgba(255,255,255,.4);font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">\ud83c\udfc6 TOP CONVERTERS</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:#fbbf24;font-size:12px">\ud83e\udd47</span><span style="flex:1;color:#fff;font-size:11px">Instagram Bio</span><span id="cf-top1-clicks" style="color:rgba(255,255,255,.4);font-size:10px">— clicks</span><span id="cf-top1-earn" style="color:#22c55e;font-size:10px;font-weight:600;margin-left:8px">—</span></div>
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:#9ca3af;font-size:12px">\ud83e\udd48</span><span style="flex:1;color:#fff;font-size:11px">TikTok Video</span><span id="cf-top2-clicks" style="color:rgba(255,255,255,.4);font-size:10px">— clicks</span><span id="cf-top2-earn" style="color:#22c55e;font-size:10px;font-weight:600;margin-left:8px">—</span></div>
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0"><span style="color:#cd7f32;font-size:12px">\ud83e\udd49</span><span style="flex:1;color:#fff;font-size:11px">WhatsApp Share</span><span id="cf-top3-clicks" style="color:rgba(255,255,255,.4);font-size:10px">— clicks</span><span id="cf-top3-earn" style="color:#22c55e;font-size:10px;font-weight:600;margin-left:8px">—</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px;text-align:center"><div style="color:rgba(255,255,255,.4);font-size:8px;text-transform:uppercase;margin-bottom:3px">AVG LIFETIME VALUE</div><div id="cf-ltv" style="color:#22c55e;font-size:16px;font-weight:800">—</div></div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px;text-align:center"><div style="color:rgba(255,255,255,.4);font-size:8px;text-transform:uppercase;margin-bottom:3px">REPEAT RATE</div><div id="cf-repeat" style="color:#FF6D00;font-size:16px;font-weight:800">—</div></div>
      </div>
    </div>
    <!-- Screen 2: CONTENT -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:none;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div><h2 style="font-size:18px;font-weight:800;color:#fff;margin:0">\ud83d\udcf9 Content</h2><p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">Your vault</p></div>
        <div style="display:flex;gap:4px"><button onclick="alert('\ud83d\udcf9 Upload')" style="background:#FF6D00;color:#fff;border:none;padding:6px 10px;border-radius:8px;font-weight:700;font-size:10px;cursor:pointer">Upload</button><button onclick="alert('\ud83c\udfa5 Record')" style="background:rgba(255,255,255,.06);color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.06);padding:6px 10px;border-radius:8px;font-weight:700;font-size:10px;cursor:pointer">Record</button></div>
      </div>
      <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:10px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">\u23f0</span>
        <div style="flex:1"><div style="color:#60a5fa;font-size:11px;font-weight:600">1 Scheduled Post</div><div style="color:rgba(255,255,255,.35);font-size:9px">Tomorrow 6:00 PM</div></div>
        <span style="color:rgba(255,255,255,.3);font-size:10px;cursor:pointer" onclick="alert('Edit')">Edit</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px">
          <div style="width:48px;height:64px;border-radius:8px;background:linear-gradient(135deg,#FF6D00,#c45200);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:20px">\ud83c\udfac</span></div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Leg Day at Crunch</div><div style="color:rgba(255,255,255,.35);font-size:9px">2.4K views \u00b7 3 bookings</div></div>
          <div style="text-align:right"><div style="font-size:12px;font-weight:800;color:#22c55e">\u00a33.60</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px">
          <div style="width:48px;height:64px;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:20px">\ud83d\udcaa</span></div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Morning HIIT Routine</div><div style="color:rgba(255,255,255,.35);font-size:9px">1.8K views \u00b7 2 bookings</div></div>
          <div style="text-align:right"><div style="font-size:12px;font-weight:800;color:#22c55e">\u00a32.40</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px">
          <div style="width:48px;height:64px;border-radius:8px;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:20px">\ud83c\udfcb\ufe0f</span></div>
          <div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Best Gym in London</div><div style="color:rgba(255,255,255,.35);font-size:9px">956 views \u00b7 1 booking</div></div>
          <div style="text-align:right"><div style="font-size:12px;font-weight:800;color:#22c55e">\u00a31.20</div></div>
        </div>
      </div>
      <div style="margin-top:12px;background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.15);border-radius:12px;padding:10px;cursor:pointer" onclick="alert('\ud83d\udce8 Mass message')">
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">\ud83d\udce8</span><div><div style="color:#c084fc;font-size:11px;font-weight:600">Mass Message</div><div style="color:rgba(255,255,255,.3);font-size:9px">Send gym recs to all followers</div></div></div>
      </div>
    </div>
    <!-- Screen 3: EARNINGS -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:none;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">\ud83d\udcb0 Earnings</h2>
      <p style="color:rgba(255,255,255,.4);font-size:11px;margin-bottom:14px">25% commission on every booking</p>
      <div style="background:linear-gradient(135deg,rgba(34,197,94,.1),rgba(34,197,94,.02));border:1px solid rgba(34,197,94,.15);border-radius:16px;padding:16px;text-align:center;margin-bottom:12px">
        <div style="color:rgba(255,255,255,.4);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">AVAILABLE TO WITHDRAW</div>
        <div id="cf-balance" style="font-size:34px;font-weight:900;color:#22c55e;margin-bottom:3px">—</div>
        <div id="cf-balance-sub" style="color:rgba(255,255,255,.3);font-size:10px">Loading...</div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <button onclick="navigate('/wallet')" style="flex:1;background:#22c55e;color:#fff;border:none;padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 4px 16px rgba(34,197,94,.25)">\ud83d\udcb0 Withdraw from Wallet</button>
        <button onclick="navigate('/creator-earnings')" style="flex:1;background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">\ud83d\udcca Details</button>
      </div>
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px;margin-bottom:10px">
        <div style="color:rgba(255,255,255,.4);font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">STATEMENT</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.6);font-size:11px">Gross Bookings</span><span id="cf-gross" style="color:#fff;font-size:11px;font-weight:600">—</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.6);font-size:11px">Your Commission (25%)</span><span id="cf-commission" style="color:#22c55e;font-size:11px;font-weight:600">—</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:rgba(255,255,255,.6);font-size:11px">Paid Out</span><span id="cf-paid" style="color:rgba(255,255,255,.6);font-size:11px">—</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:#fff;font-size:11px;font-weight:700">Balance</span><span id="cf-statement-bal" style="color:#22c55e;font-size:11px;font-weight:700">—</span></div>
      </div>
      <div style="display:flex;gap:4px">
        <div style="flex:1;background:#FF6D00;border-radius:8px;padding:6px;text-align:center;color:#fff;font-size:10px;font-weight:700;cursor:pointer">This Month</div>
        <div style="flex:1;background:rgba(255,255,255,.06);border-radius:8px;padding:6px;text-align:center;color:rgba(255,255,255,.5);font-size:10px;font-weight:600;cursor:pointer" onclick="_showCreatorScreen(3);_loadCreatorFullPage();" data-period="month">Last Month</div>
        <div style="flex:1;background:rgba(255,255,255,.06);border-radius:8px;padding:6px;text-align:center;color:rgba(255,255,255,.5);font-size:10px;font-weight:600;cursor:pointer" onclick="_showCreatorScreen(3);_loadCreatorFullPage();" data-period="all">All Time</div>
      </div>
    </div>
    <!-- Screen 4: STOREFRONT -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:none;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">\ud83c\udfe0 Your Storefront</h2>
      <p style="color:rgba(255,255,255,.4);font-size:11px;margin-bottom:14px">Your personal gym recommendation page</p>
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:40px;height:40px;background:linear-gradient(135deg,#a855f7,#7c3aed);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px">${firstName[0]}</div>
          <div><div style="color:#fff;font-size:13px;font-weight:700">${name}'s Picks</div><div style="color:rgba(255,255,255,.35);font-size:9px">scangym.com/s/${refCode}</div></div>
        </div>
        <div style="color:rgba(255,255,255,.5);font-size:10px;margin-bottom:8px;font-style:italic">"My favourite gyms \u2014 tried & tested \ud83d\udcaa"</div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">
          <div style="min-width:90px;background:rgba(255,255,255,.04);border-radius:10px;padding:8px;text-align:center;flex-shrink:0"><div style="font-size:20px;margin-bottom:4px">\ud83c\udfcb\ufe0f</div><div style="color:#fff;font-size:9px;font-weight:600">PureGym</div><div style="color:#22c55e;font-size:8px">\u00a34.99</div></div>
          <div style="min-width:90px;background:rgba(255,255,255,.04);border-radius:10px;padding:8px;text-align:center;flex-shrink:0"><div style="font-size:20px;margin-bottom:4px">\ud83d\udcaa</div><div style="color:#fff;font-size:9px;font-weight:600">The Gym</div><div style="color:#22c55e;font-size:8px">\u00a33.99</div></div>
          <div onclick="alert('Add gym')" style="min-width:90px;background:rgba(255,255,255,.02);border:2px dashed rgba(255,255,255,.1);border-radius:10px;padding:8px;text-align:center;cursor:pointer;flex-shrink:0"><div style="font-size:20px;margin-bottom:4px">\u2795</div><div style="color:rgba(255,255,255,.3);font-size:9px">Add Gym</div></div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <button onclick="navigator.clipboard.writeText('https://scangym.com/s/${refCode}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Link',1500)" style="flex:1;background:#a855f7;color:#fff;border:none;padding:10px;border-radius:10px;font-weight:700;font-size:11px;cursor:pointer">Copy Link</button>
        <button onclick="alert('\ud83c\udfa8 Customize')" style="flex:1;background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.08);padding:10px;border-radius:10px;font-weight:700;font-size:11px;cursor:pointer">\ud83c\udfa8 Customize</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px;text-align:center"><div style="color:#a855f7;font-size:14px;font-weight:800">89</div><div style="color:rgba(255,255,255,.3);font-size:8px">Page Views</div></div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px;text-align:center"><div style="color:#FF6D00;font-size:14px;font-weight:800">12</div><div style="color:rgba(255,255,255,.3);font-size:8px">Clicks</div></div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px;text-align:center"><div style="color:#22c55e;font-size:14px;font-weight:800">\u00a32.40</div><div style="color:rgba(255,255,255,.3);font-size:8px">From Store</div></div>
      </div>
    </div>
    <!-- Screen 5: ASSETS -->
    <div class="creator-screen" style="position:absolute;top:0;left:0;right:0;bottom:0;display:none;flex-direction:column;padding:16px;padding-right:60px;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">\ud83c\udfa8 Asset Library</h2>
      <p style="color:rgba(255,255,255,.4);font-size:11px;margin-bottom:14px">Ready-made content to boost earnings</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div onclick="_cfDownloadAsset('ScanGym-Asset1-Hero-Banner.webp')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px;cursor:pointer"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(255,109,0,.12)">\ud83d\uddbc</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Hero Banner</div><div style="font-size:9px;color:rgba(255,255,255,.35)">1080\u00d71080 \u00b7 Instagram/TikTok</div></div><span style="font-size:10px;color:#FF6D00;font-weight:600">\ud83d\udce5</span></div>
        <div onclick="_cfDownloadAsset('ScanGym-Asset7-Price-Comparison.webp')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px;cursor:pointer"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(34,197,94,.12)">\ud83d\udcca</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Price Comparison Card</div><div style="font-size:9px;color:rgba(255,255,255,.35)">ScanGym vs Memberships</div></div><span style="font-size:10px;color:#FF6D00;font-weight:600">\ud83d\udce5</span></div>
        <div onclick="_cfDownloadAsset('ScanGym-Asset6-Viral-Hook.webp')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px;cursor:pointer"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(168,85,247,.12)">\ud83c\udfaf</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Viral Hook Scripts</div><div style="font-size:9px;color:rgba(255,255,255,.35)">5 proven TikTok hooks + captions</div></div><span style="font-size:10px;color:#FF6D00;font-weight:600">\ud83d\udce5</span></div>
        <div onclick="_cfDownloadAsset('ScanGym-Asset4-DM-Outreach-Card.webp')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px;cursor:pointer"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(59,130,246,.12)">\ud83d\udcac</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">DM Outreach Templates</div><div style="font-size:9px;color:rgba(255,255,255,.35)">Copy-paste influencer messages</div></div><span style="font-size:10px;color:#FF6D00;font-weight:600">\ud83d\udce5</span></div>
        <div onclick="_cfDownloadAsset('ScanGym-Asset5-Uber-For-Gyms-Story.webp')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:12px;cursor:pointer"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(255,109,0,.12)">\ud83d\udcf1</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#fff">Story Templates</div><div style="font-size:9px;color:rgba(255,255,255,.35)">IG/TikTok story formats</div></div><span style="font-size:10px;color:#FF6D00;font-weight:600">\ud83d\udce5</span></div>
      </div>
    </div>
  </div>`;
}

window._showCreatorScreen=function(idx){
  var screens=document.querySelectorAll('.creator-screen');
  screens.forEach(function(s,i){s.style.display=i===idx?'flex':'none';});
  // Highlight More button when viewing a screen from the More menu
  var moreBtn=document.getElementById('creator-more-btn');
  if(moreBtn){
    var isMoreScreen=(idx===0||idx===1||idx===2||idx===4||idx===5);
    moreBtn.style.background=isMoreScreen?'rgba(255,109,0,.25)':'rgba(255,255,255,.08)';
    moreBtn.style.borderColor=isMoreScreen?'rgba(255,109,0,.4)':'rgba(255,255,255,.06)';
    moreBtn.style.boxShadow=isMoreScreen?'0 0 16px rgba(255,109,0,.2)':'none';
  }
};

window._toggleCreatorMore=function(){
  var m=document.getElementById('creator-more-menu');
  if(m) m.style.display=m.style.display==='none'?'block':'none';
};

window._closeCreatorMore=function(){
  var m=document.getElementById('creator-more-menu');
  if(m) m.style.display='none';
};

window._creatorGetLink=function(){
  var u=state&&state.user;
  if(!u){
    sgToast('Sign in to get your affiliate link','info',2000);
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}else{navigate('/login');}
    return;
  }
  var refCode=u.referral_code;
  if(!refCode){
    refCode=(u.name||'').replace(/[^a-z0-9]/gi,'').toLowerCase()||(u.phone||'').replace(/[^0-9]/g,'').slice(-6)||('sg'+Date.now().toString(36));
    u.referral_code=refCode;
    fetch('/api/v2/creator-apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      first_name:(u.name||'').split(' ')[0]||'',last_name:(u.name||'').split(' ').slice(1).join(' ')||'',
      email:u.email||'',instagram:'',tiktok:'',youtube:'',followers:'',why:'auto-affiliate-link'
    })}).catch(function(){});
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    cd.handle=refCode;cd.name=u.name||'';cd.email=u.email||'';cd.autoCreated=true;
    localStorage.setItem('sg_creator',JSON.stringify(cd));
    fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:refCode})}).catch(function(){});
  }
  var refLink='https://scangym.com/r/'+refCode;
  var deepLink='scangym://r/'+refCode;
  _sgOpenSheet('sg-affiliate-sheet',
    '<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 16px">\ud83d\udd17 Your Affiliate Links</h2>'
    +'<div style="background:#1a1a1a;border-radius:16px;padding:16px;border:1px solid rgba(255,255,255,.08);margin-bottom:14px">'
    +'<div style="font-weight:700;font-size:14px;color:#fff;margin-bottom:8px">\ud83d\udcce Web Affiliate Link</div>'
    +'<div style="background:#222;border:1px solid #FF6D00;border-radius:10px;padding:12px;font-size:12px;color:#FF6D00;font-family:monospace;word-break:break-all;margin-bottom:10px">'+refLink+'</div>'
    +'<div style="display:flex;gap:8px">'
    +'<button id="sg-copy-aff" onclick="navigator.clipboard.writeText(\''+refLink+'\').then(function(){sgToast(\'Affiliate link copied!\',\'success\',2000);document.getElementById(\'sg-copy-aff\').textContent=\'Copied!\';setTimeout(function(){try{document.getElementById(\'sg-copy-aff\').textContent=\'\ud83d\udccb Copy Link\'}catch(e){}},1500)}).catch(function(){sgToast(\''+refLink+'\',\'info\',5000)})" style="flex:1;background:#FF6D00;color:#fff;border:none;padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">\ud83d\udccb Copy Link</button>'
    +'<button onclick="if(navigator.share){navigator.share({title:\'ScanGym\',text:\'Book any gym with no membership!\',url:\''+refLink+'\'}).catch(function(){})}else{navigator.clipboard.writeText(\''+refLink+'\');sgToast(\'Link copied!\',\'success\',2000)}" style="flex:1;background:transparent;color:#FF6D00;border:2px solid #FF6D00;padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">\ud83d\udce4 Share</button>'
    +'</div></div>'
    +'<div style="background:#1a1a1a;border-radius:16px;padding:16px;border:1px solid rgba(255,255,255,.08);margin-bottom:14px">'
    +'<div style="font-weight:700;font-size:14px;color:#fff;margin-bottom:8px">\ud83d\udd17 Deep Link (App)</div>'
    +'<div style="background:#222;border:1px solid #FF6D00;border-radius:10px;padding:12px;font-size:12px;color:#FF6D00;font-family:monospace;word-break:break-all;margin-bottom:10px">'+deepLink+'</div>'
    +'<div style="display:flex;gap:8px">'
    +'<button id="sg-copy-deep" onclick="navigator.clipboard.writeText(\''+deepLink+'\').then(function(){sgToast(\'Deep link copied!\',\'success\',2000);document.getElementById(\'sg-copy-deep\').textContent=\'Copied!\';setTimeout(function(){try{document.getElementById(\'sg-copy-deep\').textContent=\'\ud83d\udccb Copy Deep Link\'}catch(e){}},1500)}).catch(function(){sgToast(\''+deepLink+'\',\'info\',5000)})" style="flex:1;background:#FF6D00;color:#fff;border:none;padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">\ud83d\udccb Copy Deep Link</button>'
    +'<button onclick="if(navigator.share){navigator.share({title:\'ScanGym\',url:\''+deepLink+'\'}).catch(function(){})}else{navigator.clipboard.writeText(\''+deepLink+'\');sgToast(\'Deep link copied!\',\'success\',2000)}" style="flex:1;background:transparent;color:#FF6D00;border:2px solid #FF6D00;padding:12px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer">\ud83d\udce4 Share</button>'
    +'</div></div>'
    +'<div style="background:linear-gradient(135deg,rgba(255,109,0,.1),rgba(255,109,0,.02));border:1px solid rgba(255,109,0,.15);border-radius:16px;padding:16px;text-align:center">'
    +'<div style="font-size:28px;margin-bottom:8px">\ud83d\udcb0</div>'
    +'<div style="color:#fff;font-weight:700;font-size:16px;margin-bottom:4px">Earn 25% Commission</div>'
    +'<div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.5">Share your link anywhere \u2014 social media, DMs, stories. You earn 25% on every gym booking!</div>'
    +'</div>'
  );
};

window._loadCreatorFullPage=async function(){
  var cd=JSON.parse(localStorage.getItem('sg_creator')||'null');
  var handle=cd&&(cd.handle||cd.slug);
  if(!handle){var u=state&&state.user;if(u)handle=u.referral_code;}
  if(!handle){
    /* FIX: Auto-generate creator handle when missing so earnings always load */
    var _u=state&&state.user;
    if(!_u)return;
    handle=(_u.name||'').replace(/[^a-z0-9]/gi,'').toLowerCase()||(_u.phone||'').replace(/[^0-9]/g,'').slice(-6)||('sg'+Date.now().toString(36));
    if(_u)_u.referral_code=handle;
    var _cd=cd||{};_cd.handle=handle;_cd.name=_u.name||'';_cd.email=_u.email||'';_cd.autoCreated=true;
    localStorage.setItem('sg_creator',JSON.stringify(_cd));
    fetch('/api/v2/creator-apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      first_name:(_u.name||'').split(' ')[0]||'',last_name:(_u.name||'').split(' ').slice(1).join(' ')||'',
      email:_u.email||'',instagram:'',tiktok:'',youtube:'',followers:'',why:'auto-creator-dashboard'
    })}).catch(function(){});
    fetch('/api/creators/sync-handle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:handle})}).catch(function(){});
  }
  var el=function(id){return document.getElementById(id);};
  try{
    // Fetch stats + earnings + balance + channels in parallel
    var [statsR,earningsR,balR,chR]=await Promise.all([
      fetch('/api/referrals/stats/'+encodeURIComponent(handle)).then(function(r){return r.json();}).catch(function(){return {};}),
      fetch('/api/referrals/earnings/'+encodeURIComponent(handle)).then(function(r){return r.json();}).catch(function(){return {};}),
      fetch('/api/referrals/balance/'+encodeURIComponent(handle)).then(function(r){return r.json();}).catch(function(){return {};}),
      fetch('/api/referrals/channels/'+encodeURIComponent(handle)).then(function(r){return r.json();}).catch(function(){return {};})
    ]);
    // ── Screen 0: Home stats ──
    var clicks=parseInt(earningsR.totalClicks)||0;
    var bookings=parseInt(earningsR.totalConversions)||0;
    var earnPence=parseInt(earningsR.totalEarningsPence)||0;
    var earnDisp=sgSymbol()+(earnPence/100).toFixed(2);
    if(el('cf-reels'))el('cf-reels').textContent=earningsR.totalDownloads||0;
    if(el('cf-clicks'))el('cf-clicks').textContent=clicks;
    if(el('cf-bookings'))el('cf-bookings').textContent=bookings;
    if(el('cf-earned'))el('cf-earned').textContent=earnDisp;
    // Ranking — approximate percentile from conversions
    var pct=bookings>=50?1:bookings>=20?5:bookings>=10?10:bookings>=5?15:bookings>=1?30:50;
    if(el('cf-ranking'))el('cf-ranking').textContent='Top '+pct+'%';
    // ── Screen 1: Analytics ──
    var chans=(chR.channels||[]);
    var refEarn=0,reelEarn=0,qrEarn=0;
    chans.forEach(function(c){
      if(c.channel==='referral'||c.channel==='direct')refEarn+=c.earningsPence||0;
      else if(c.channel==='reel')reelEarn+=c.earningsPence||0;
      else if(c.channel==='qr')qrEarn+=c.earningsPence||0;
    });
    if(el('cf-src-referral'))el('cf-src-referral').textContent=sgSymbol()+(refEarn/100).toFixed(2);
    if(el('cf-src-reels'))el('cf-src-reels').textContent=sgSymbol()+(reelEarn/100).toFixed(2);
    if(el('cf-src-qr'))el('cf-src-qr').textContent=sgSymbol()+(qrEarn/100).toFixed(2);
    // Today live stats
    if(el('cf-today-clicks'))el('cf-today-clicks').textContent=clicks;
    if(el('cf-today-orders'))el('cf-today-orders').textContent=bookings;
    var rate=clicks>0?((bookings/clicks)*100).toFixed(1):'0.0';
    if(el('cf-today-rate'))el('cf-today-rate').textContent=rate+'%';
    // Top converters — use channel data
    if(chans.length>=1){if(el('cf-top1-clicks'))el('cf-top1-clicks').textContent=chans[0].clicks+' clicks';if(el('cf-top1-earn'))el('cf-top1-earn').textContent=chans[0].earnings;}
    if(chans.length>=2){if(el('cf-top2-clicks'))el('cf-top2-clicks').textContent=chans[1].clicks+' clicks';if(el('cf-top2-earn'))el('cf-top2-earn').textContent=chans[1].earnings;}
    if(chans.length>=3){if(el('cf-top3-clicks'))el('cf-top3-clicks').textContent=chans[2].clicks+' clicks';if(el('cf-top3-earn'))el('cf-top3-earn').textContent=chans[2].earnings;}
    // LTV and repeat
    var ltv=bookings>0?((earnPence/bookings)/100).toFixed(2):'0.00';
    if(el('cf-ltv'))el('cf-ltv').textContent=sgSymbol()+ltv;
    if(el('cf-repeat'))el('cf-repeat').textContent=bookings>3?'34%':'0%';
    // ── Screen 3: Earnings (wallet balance = single source of truth) ──
    // Fetch wallet balance for the "AVAILABLE TO WITHDRAW" display
    try{
      var walRes=await fetch('/api/wallet',{credentials:'include'});
      var walData=await walRes.json();
      var walletPence=(walData.balancePence!==undefined)?(walData.balancePence||0):0;
      if(el('cf-balance'))el('cf-balance').textContent=sgSymbol()+(walletPence/100).toFixed(2);
      if(el('cf-balance-sub'))el('cf-balance-sub').textContent='ScanGym Wallet \u00b7 '+bookings+' booking'+(bookings!==1?'s':'')+' total';
      if(el('cf-statement-bal'))el('cf-statement-bal').textContent=sgSymbol()+(walletPence/100).toFixed(2);
    }catch(walE){
      if(el('cf-balance'))el('cf-balance').textContent=sgSymbol()+'0.00';
      if(el('cf-balance-sub'))el('cf-balance-sub').textContent='Sign in to see wallet balance';
    }
    var grossPence=bookings>0?Math.round(earnPence/0.25):0;
    if(el('cf-gross'))el('cf-gross').textContent=sgSymbol()+(grossPence/100).toFixed(2);
    if(el('cf-commission'))el('cf-commission').textContent=sgSymbol()+(earnPence/100).toFixed(2);
    var paidPence=(balR.totalWithdrawnPence||0);
    if(el('cf-paid'))el('cf-paid').textContent=sgSymbol()+(paidPence/100).toFixed(2);
  }catch(e){console.error('[CreatorFull] Load failed:',e);}
};

function CreatorReelsPage(){
  var u=state.user;
  var creator=JSON.parse(localStorage.getItem('sg_creator')||'null');
  return`<div style="max-width:480px;margin:0 auto;padding:20px 16px">
    <div class="sg-more-back" onclick="navigate('/more')">← Back</div>
    <h1 style="font-size:24px;font-weight:900;color:#fff;margin-bottom:4px">🎬 Creator Reels</h1>
    <p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:24px">Your content, earnings & downloads</p>

    ${creator?'<div style="background:rgba(255,109,0,.08);border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:16px;margin-bottom:20px"><div style="display:flex;justify-content:space-between;align-items:center"><div><p style="color:rgba(255,255,255,.4);font-size:12px">Your Earnings</p><p style="color:#FF6D00;font-size:28px;font-weight:900">£0.00</p></div><div style="text-align:right"><p style="color:rgba(255,255,255,.4);font-size:12px">Downloads</p><p style="color:#fff;font-size:28px;font-weight:900">0</p></div></div></div>':''}

    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      ${['#Workout','#GymLife','#Fitness','#Gains','#Motivation','#ScanGym'].map(function(tag){return'<span style="background:rgba(255,109,0,.1);border:1px solid rgba(255,109,0,.2);border-radius:20px;padding:6px 14px;color:#FF6D00;font-size:12px;font-weight:600;cursor:pointer">'+tag+'</span>';}).join('')}
    </div>

    <div style="text-align:center;padding:24px">
      <p style="font-size:48px;margin-bottom:12px">🎬</p>
      <p style="color:rgba(255,255,255,.5);font-size:14px;margin-bottom:16px">No reels yet. Create your first one!</p>
      <button onclick="navigate('/reels')" style="background:#FF6D00;color:#fff;border:none;padding:12px 32px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer">📹 Create Reel</button>
    </div>
  </div>`;
}
