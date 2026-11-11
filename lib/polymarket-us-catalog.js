 'use strict';
const BASE='https://gateway.polymarket.us';
const LEAGUE={americanfootball_nfl:'nfl',americanfootball_ncaaf:'cfb',baseball_mlb:'mlb',basketball_nba:'nba',basketball_ncaab:'cbb',icehockey_nhl:'nhl',basketball_wnba:'wnba',soccer_uefa_champs_league:'ucl'};
async function listEvents(sport, getJson) {
 const league=LEAGUE[sport];if(!league)return [];
 const r=await getJson(`${BASE}/v2/leagues/${league}/events?limit=100&active=true&closed=false`);
 const body=r && (r.json || r.body || r);return r && r.ok === false ? [] : (Array.isArray(body)?body:(body.events || body.data || []));
}
module.exports={BASE,LEAGUE,listEvents};
