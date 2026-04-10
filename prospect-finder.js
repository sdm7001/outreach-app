const axios = require('axios');
const config = require('./config');
const db = require('./db');

const SEARCH_QUERIES = [
  { query: 'medical clinic', industry: 'Healthcare' },
  { query: 'dental practice', industry: 'Healthcare' },
  { query: 'orthopedic clinic', industry: 'Healthcare' },
  { query: 'dermatology clinic', industry: 'Healthcare' },
  { query: 'pediatric clinic', industry: 'Healthcare' },
  { query: 'law firm', industry: 'Law Practice' },
  { query: 'personal injury lawyer', industry: 'Law Practice' },
  { query: 'family law attorney', industry: 'Law Practice' },
  { query: 'immigration lawyer', industry: 'Law Practice' },
  { query: 'CPA firm', industry: 'Accounting' },
  { query: 'accounting firm', industry: 'Accounting' },
  { query: 'financial advisor', industry: 'Financial Services' },
  { query: 'physical therapy clinic', industry: 'Healthcare' },
  { query: 'veterinary clinic', industry: 'Healthcare' },
  { query: 'optometry practice', industry: 'Healthcare' },
  { query: 'chiropractic clinic', industry: 'Healthcare' },
  { query: 'urgent care center', industry: 'Healthcare' },
  { query: 'mental health clinic', industry: 'Healthcare' },
  { query: 'tax preparation firm', industry: 'Accounting' },
  { query: 'real estate law firm', industry: 'Law Practice' }
];

/**
 * Find prospects using Apollo.io API (primary) or Google Places API (fallback)
 */
async function findProspects() {
  const results = [];

  if (config.APOLLO_API_KEY) {
    console.log('[Prospect Finder] Using Apollo.io API...');
    const apolloResults = await findViaApollo();
    results.push(...apolloResults);
  } else if (config.GOOGLE_PLACES_API_KEY) {
    console.log('[Prospect Finder] Apollo API key not set, using Google Places fallback...');
    const placesResults = await findViaGooglePlaces();
    results.push(...placesResults);
  } else {
    console.log('[Prospect Finder] WARNING: No Apollo or Google Places API key set. Skipping prospect finding.');
    console.log('[Prospect Finder] Set APOLLO_API_KEY or GOOGLE_PLACES_API_KEY in .env to enable.');
    return [];
  }

  // Deduplicate and save to DB
  let added = 0;
  for (const prospect of results) {
    if (!db.prospectExists(prospect.company_name, prospect.domain)) {
      db.addProspect(prospect);
      added++;
    }
  }

  db.incrementStat('prospects_found');
  console.log(`[Prospect Finder] Found ${results.length} prospects, added ${added} new to DB`);
  return results.slice(0, config.DAILY_PROSPECT_LIMIT);
}

async function findViaApollo() {
  const results = [];

  try {
    // Search for people at target companies
    const response = await axios.post('https://api.apollo.io/v1/mixed_people/search', {
      api_key: config.APOLLO_API_KEY,
      person_titles: config.TARGET_TITLES,
      organization_industry_tag_ids: [],
      q_organization_keyword_tags: config.TARGET_INDUSTRIES,
      organization_locations: config.TARGET_LOCATIONS,
      organization_num_employees_ranges: [`${config.TARGET_EMPLOYEE_RANGE[0]},${config.TARGET_EMPLOYEE_RANGE[1]}`],
      per_page: config.DAILY_PROSPECT_LIMIT,
      page: 1
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    if (response.data && response.data.people) {
      for (const person of response.data.people) {
        const org = person.organization || {};
        results.push({
          company_name: org.name || 'Unknown',
          domain: org.primary_domain || '',
          industry: org.industry || 'Unknown',
          employee_count: org.estimated_num_employees || 0,
          city: person.city || org.city || 'Houston',
          state: person.state || org.state || 'TX',
          contact_name: person.name || '',
          contact_title: person.title || '',
          contact_email: person.email || '',
          score: scoreProspect(person, org),
          source: 'apollo'
        });
      }
    }
  } catch (err) {
    console.error(`[Prospect Finder] Apollo API error: ${err.message}`);
    if (err.response) {
      console.error(`[Prospect Finder] Status: ${err.response.status}`);
    }
  }

  return results;
}

async function findViaGooglePlaces() {
  const results = [];

  // Pick random queries to avoid duplication
  const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
  const queriesToRun = shuffled.slice(0, 3);

  for (const { query, industry } of queriesToRun) {
    try {
      const searchQuery = `${query} Houston Texas`;
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: {
          query: searchQuery,
          key: config.GOOGLE_PLACES_API_KEY,
          type: 'establishment'
        },
        timeout: 15000
      });

      if (response.data && response.data.results) {
        for (const place of response.data.results.slice(0, 5)) {
          // Extract domain from website if available
          let domain = '';
          let website = '';

          // Get place details for website
          try {
            const detailResp = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
              params: {
                place_id: place.place_id,
                fields: 'website,formatted_phone_number',
                key: config.GOOGLE_PLACES_API_KEY
              },
              timeout: 10000
            });
            website = detailResp.data?.result?.website || '';
            if (website) {
              const url = new URL(website);
              domain = url.hostname.replace('www.', '');
            }
          } catch (e) {
            // Skip details if it fails
          }

          results.push({
            company_name: place.name,
            domain: domain,
            industry: industry,
            employee_count: 50, // Estimate
            city: 'Houston',
            state: 'TX',
            contact_name: '',
            contact_title: '',
            contact_email: '',
            score: 50,
            source: 'google_places'
          });
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Prospect Finder] Google Places error for "${query}": ${err.message}`);
    }
  }

  return results;
}

function scoreProspect(person, org) {
  let score = 50;

  // Title match bonus
  const titleLower = (person.title || '').toLowerCase();
  if (titleLower.includes('owner') || titleLower.includes('ceo')) score += 20;
  if (titleLower.includes('office manager') || titleLower.includes('practice admin')) score += 15;
  if (titleLower.includes('managing partner')) score += 18;
  if (titleLower.includes('it director')) score += 10;

  // Has email
  if (person.email) score += 15;

  // Employee count sweet spot (50-150)
  const emp = org.estimated_num_employees || 0;
  if (emp >= 50 && emp <= 150) score += 10;
  if (emp >= 25 && emp < 50) score += 5;

  // Industry bonus
  const industry = (org.industry || '').toLowerCase();
  if (industry.includes('health') || industry.includes('medical')) score += 10;
  if (industry.includes('legal') || industry.includes('law')) score += 8;

  return Math.min(score, 100);
}

module.exports = { findProspects };
