const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./db');

const SYSTEM_PROMPT = `You write cold outreach emails for two companies:

1. **TexMG** - Houston's premier managed IT provider. 20+ years serving Houston businesses. Services: managed IT support, cybersecurity, cloud solutions, HIPAA compliance, network management, help desk.

2. **Talos Automation AI** - AI automation division. Services: AI voice agents for front desk/scheduling, workflow automation, document processing AI, AI-powered patient/client intake, custom AI solutions.

RULES:
- Keep emails under 120 words total (subject + body combined should feel concise)
- Natural, conversational human tone - like you're writing to someone you bumped into at a Houston Chamber event
- Lead with ONE specific pain point or result that's relevant to their industry
- One clear call-to-action (15-min call, quick demo, etc.)
- Never sound like a mass email or template
- Never use phrases like "I hope this email finds you well" or "I wanted to reach out"
- Use the contact's first name if available
- Reference Houston or their specific area when natural
- Sign off as Lindsay Thompson, Business Development, TexMG
- Include BOTH TexMG and Talos angle when the pain point allows, but don't force both

Output format (respond with ONLY this, no other text):
SUBJECT: [subject line - 6-10 words, no clickbait]
BODY: [email body - under 120 words]`;

/**
 * Generate personalized email messages for enriched prospects
 */
async function generateMessages() {
  if (!config.ANTHROPIC_API_KEY) {
    console.log('[Message Generator] WARNING: No ANTHROPIC_API_KEY set. Skipping message generation.');
    console.log('[Message Generator] Set ANTHROPIC_API_KEY in .env to enable.');
    return [];
  }

  const prospects = db.getProspectsNeedingMessages(config.DAILY_PROSPECT_LIMIT);
  console.log(`[Message Generator] Generating messages for ${prospects.length} prospects...`);

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const generated = [];

  for (const prospect of prospects) {
    try {
      const angle = config.PAIN_ANGLES.find(a => a.angle === prospect.outreach_angle)
        || config.PAIN_ANGLES[0];

      const userPrompt = buildUserPrompt(prospect, angle);

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const text = response.content[0].text.trim();
      const parsed = parseEmailResponse(text);

      if (parsed.subject && parsed.body) {
        db.updateProspect(prospect.id, {
          email_subject: parsed.subject,
          email_body: parsed.body,
          status: 'enriched'  // Keep enriched until sent
        });

        generated.push({
          id: prospect.id,
          company: prospect.company_name,
          subject: parsed.subject,
          body: parsed.body
        });

        console.log(`[Message Generator] Generated for ${prospect.company_name}: "${parsed.subject}"`);
      } else {
        console.error(`[Message Generator] Failed to parse response for ${prospect.company_name}`);
      }

      // Rate limit (avoid hammering the API)
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Message Generator] Error for ${prospect.company_name}: ${err.message}`);
    }
  }

  console.log(`[Message Generator] Generated ${generated.length}/${prospects.length} messages`);
  return generated;
}

function buildUserPrompt(prospect, angle) {
  const firstName = prospect.contact_name ? prospect.contact_name.split(' ')[0] : '';

  return `Write a cold email for this prospect:

Company: ${prospect.company_name}
Industry: ${prospect.industry}
Contact: ${prospect.contact_name || 'Decision Maker'}
Title: ${prospect.contact_title || 'Practice Leader'}
City: ${prospect.city || 'Houston'}, ${prospect.state || 'TX'}
Employee count: ~${prospect.employee_count || 'unknown'}

Pain angle to lead with: ${angle.desc}

${firstName ? `Use their first name "${firstName}" in the greeting.` : 'Use a generic but warm greeting.'}

Remember: Under 120 words total. One pain point. One CTA. Sound human.`;
}

function parseEmailResponse(text) {
  const subjectMatch = text.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);

  return {
    subject: subjectMatch ? subjectMatch[1].trim() : '',
    body: bodyMatch ? bodyMatch[1].trim() : ''
  };
}

module.exports = { generateMessages };
