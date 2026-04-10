const axios = require('axios');
const config = require('./config');
const db = require('./db');

/**
 * Enrich pending prospects with contact emails using Hunter.io or domain scraping
 */
async function enrichProspects() {
  const prospects = db.getPendingProspects(config.DAILY_PROSPECT_LIMIT);
  console.log(`[Contact Enricher] Enriching ${prospects.length} prospects...`);

  const enriched = [];

  for (const prospect of prospects) {
    // Skip if already has email
    if (prospect.contact_email) {
      db.updateProspect(prospect.id, { status: 'enriched' });
      enriched.push(prospect);
      continue;
    }

    let email = null;
    let contactName = prospect.contact_name;
    let contactTitle = prospect.contact_title;

    // Try Hunter.io first
    if (config.HUNTER_API_KEY && prospect.domain) {
      const hunterResult = await findViaHunter(prospect.domain);
      if (hunterResult) {
        email = hunterResult.email;
        contactName = contactName || hunterResult.name;
        contactTitle = contactTitle || hunterResult.title;
      }
    }

    // Try domain-based email guessing if no Hunter result
    if (!email && prospect.domain && contactName) {
      email = guessEmail(contactName, prospect.domain);
    }

    // Assign a pain angle (rotate through them)
    const angleIndex = enriched.length % config.PAIN_ANGLES.length;
    const angle = config.PAIN_ANGLES[angleIndex];

    const updateData = {
      status: email ? 'enriched' : 'no_email',
      contact_email: email,
      contact_name: contactName,
      contact_title: contactTitle,
      outreach_angle: angle.angle
    };

    db.updateProspect(prospect.id, updateData);

    if (email) {
      enriched.push({ ...prospect, ...updateData });
      console.log(`[Contact Enricher] Enriched: ${prospect.company_name} -> ${email}`);
    } else {
      console.log(`[Contact Enricher] No email found for: ${prospect.company_name}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[Contact Enricher] Enriched ${enriched.length}/${prospects.length} prospects`);
  return enriched;
}

async function findViaHunter(domain) {
  try {
    // Domain search - find people at the domain
    const response = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: {
        domain: domain,
        api_key: config.HUNTER_API_KEY,
        limit: 5
      },
      timeout: 15000
    });

    if (response.data && response.data.data && response.data.data.emails) {
      const emails = response.data.data.emails;

      // Prioritize by title match
      for (const entry of emails) {
        const titleLower = (entry.position || '').toLowerCase();
        for (const targetTitle of config.TARGET_TITLES) {
          if (titleLower.includes(targetTitle.toLowerCase())) {
            return {
              email: entry.value,
              name: `${entry.first_name || ''} ${entry.last_name || ''}`.trim(),
              title: entry.position || ''
            };
          }
        }
      }

      // Fall back to first email with a name
      const withName = emails.find(e => e.first_name || e.last_name);
      if (withName) {
        return {
          email: withName.value,
          name: `${withName.first_name || ''} ${withName.last_name || ''}`.trim(),
          title: withName.position || ''
        };
      }

      // Fall back to any email
      if (emails.length > 0) {
        return {
          email: emails[0].value,
          name: '',
          title: ''
        };
      }
    }
  } catch (err) {
    console.error(`[Contact Enricher] Hunter API error for ${domain}: ${err.message}`);
  }

  return null;
}

function guessEmail(name, domain) {
  // Common email patterns
  const parts = name.toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;

  const first = parts[0].replace(/[^a-z]/g, '');
  const last = parts[parts.length - 1].replace(/[^a-z]/g, '');

  if (!first || !last) return null;

  // Most common patterns: first.last@domain, first@domain, flast@domain
  // We'll use first.last as the primary guess
  return `${first}.${last}@${domain}`;
}

module.exports = { enrichProspects };
