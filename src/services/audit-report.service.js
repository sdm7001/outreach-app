'use strict';

/**
 * Audit Report PDF Generator
 *
 * Generates a branded "Free Website Marketing Audit" PDF to attach to
 * prospecting emails. The report gives the prospect immediate value and
 * is the stated reason for the cold outreach.
 *
 * Sections:
 *   1. Cover — company name, score badge, date
 *   2. Executive Summary — top finding + opportunity
 *   3. Score Breakdown — 6 dimensions with bar chart visualization
 *   4. Dimension Details — finding per dimension
 *   5. Recommended Next Steps — 3 action items TexMG can help with
 *   6. CTA footer — 15-min call offer
 */

const PDFDocument = require('pdfkit');

// Brand colors
const BRAND_DARK    = '#0f172a';
const BRAND_MID     = '#1e293b';
const BRAND_ACCENT  = '#3b82f6';
const BRAND_PURPLE  = '#8b5cf6';
const TEXT_PRIMARY  = '#f1f5f9';
const TEXT_MUTED    = '#94a3b8';
const GREEN         = '#16a34a';
const AMBER         = '#d97706';
const RED           = '#dc2626';

function scoreColor(score) {
  if (score >= 70) return GREEN;
  if (score >= 45) return AMBER;
  return RED;
}

function scoreLabel(score) {
  if (score >= 70) return 'Strong';
  if (score >= 45) return 'Needs Work';
  return 'Critical Gap';
}

/**
 * Generate a PDF report buffer for a website audit + prospect intelligence.
 *
 * @param {object} params
 * @param {object} params.audit     - website_audits DB record (with findings JSON)
 * @param {object} [params.intel]   - prospect_intelligence DB record (with full_brief JSON)
 * @param {string} params.senderName
 * @param {string} params.senderCompany
 * @param {string} params.senderEmail
 * @returns {Promise<Buffer>}
 */
async function generateAuditReportPDF({ audit, intel, senderName, senderCompany, senderEmail }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Website Marketing Audit — ${audit.company_name || audit.domain}`,
        Author: senderCompany || 'TexMG',
      },
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let findings = {};
    let brief = {};
    try { findings = JSON.parse(audit.findings || '{}'); } catch (_) {}
    try { brief = JSON.parse(intel?.full_brief || '{}'); } catch (_) {}

    const company = audit.company_name || audit.domain;
    const overall = audit.overall_score || 0;
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const dimensions = [
      { label: 'Content & Messaging',     score: audit.content_score,     finding: findings.findings?.content,     weight: '25%' },
      { label: 'Conversion Optimization', score: audit.conversion_score,  finding: findings.findings?.conversion,  weight: '20%' },
      { label: 'SEO & Visibility',         score: audit.seo_score,         finding: findings.findings?.seo,         weight: '20%' },
      { label: 'Competitive Positioning', score: audit.competitive_score,  finding: findings.findings?.competitive, weight: '15%' },
      { label: 'Brand & Trust',           score: audit.brand_score,        finding: findings.findings?.brand,       weight: '10%' },
      { label: 'Growth & Strategy',       score: audit.growth_score,       finding: findings.findings?.growth,      weight: '10%' },
    ];

    const PAGE_W = doc.page.width;
    const MARGIN = 50;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ── COVER ─────────────────────────────────────────────────────────────
    // Dark header band
    doc.rect(0, 0, PAGE_W, 180).fill(BRAND_DARK);

    // Header text
    doc.fillColor(BRAND_ACCENT).fontSize(11).font('Helvetica-Bold')
      .text('COMPLIMENTARY ANALYSIS', MARGIN, 45, { characterSpacing: 2 });

    doc.fillColor(TEXT_PRIMARY).fontSize(26).font('Helvetica-Bold')
      .text('Website Marketing Audit', MARGIN, 62);

    doc.fillColor(TEXT_MUTED).fontSize(13).font('Helvetica')
      .text(company, MARGIN, 96);

    doc.fillColor(TEXT_MUTED).fontSize(10)
      .text(`Prepared ${date} by ${senderName} · ${senderCompany}`, MARGIN, 116);

    // Overall score circle (right side)
    const circleX = PAGE_W - MARGIN - 55;
    const circleY = 90;
    const col = scoreColor(overall);
    doc.circle(circleX, circleY, 48).fill(BRAND_MID);
    doc.circle(circleX, circleY, 48).stroke(col).lineWidth(3);
    doc.fillColor(col).fontSize(30).font('Helvetica-Bold')
      .text(String(overall), circleX - 22, circleY - 18);
    doc.fillColor(TEXT_MUTED).fontSize(9).font('Helvetica')
      .text('/ 100', circleX - 10, circleY + 14);

    doc.moveDown(0);
    doc.y = 195;

    // ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────
    doc.fillColor(BRAND_DARK).fontSize(13).font('Helvetica-Bold')
      .text('Executive Summary', MARGIN, doc.y);
    doc.moveDown(0.4);

    const summaryText = findings.summary ||
      `This analysis of ${company}'s website identified key areas where strategic improvements could significantly increase lead generation and conversion rates.`;

    doc.fillColor('#334155').fontSize(10).font('Helvetica')
      .text(summaryText, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });

    if (brief.appointment_angle) {
      doc.moveDown(0.6);
      doc.rect(MARGIN, doc.y, CONTENT_W, 1).fill(BRAND_ACCENT);
      doc.moveDown(0.3);
      doc.fillColor(BRAND_ACCENT).fontSize(10).font('Helvetica-Bold')
        .text('Top Opportunity:', MARGIN, doc.y, { continued: true });
      doc.fillColor('#334155').font('Helvetica')
        .text(` ${brief.appointment_angle}`, { width: CONTENT_W });
    }

    doc.moveDown(1.2);

    // ── SCORE BREAKDOWN ───────────────────────────────────────────────────
    doc.fillColor(BRAND_DARK).fontSize(13).font('Helvetica-Bold')
      .text('Score Breakdown', MARGIN, doc.y);
    doc.moveDown(0.5);

    const BAR_H = 18;
    const BAR_MAX_W = CONTENT_W - 160;
    const LABEL_W = 150;

    for (const dim of dimensions) {
      const sc = dim.score || 0;
      const col2 = scoreColor(sc);
      const barW = Math.round((sc / 100) * BAR_MAX_W);
      const y = doc.y;

      // Label
      doc.fillColor('#334155').fontSize(9).font('Helvetica')
        .text(dim.label, MARGIN, y + 4, { width: LABEL_W });

      // Bar background
      doc.rect(MARGIN + LABEL_W, y, BAR_MAX_W, BAR_H).fill('#e2e8f0');
      // Bar fill
      if (barW > 0) doc.rect(MARGIN + LABEL_W, y, barW, BAR_H).fill(col2);

      // Score label
      doc.fillColor(col2).fontSize(9).font('Helvetica-Bold')
        .text(`${sc}  ${scoreLabel(sc)}`, MARGIN + LABEL_W + BAR_MAX_W + 8, y + 4);

      doc.moveDown(0.15);
      doc.y = y + BAR_H + 6;
    }

    doc.moveDown(1);

    // ── DIMENSION DETAILS ─────────────────────────────────────────────────
    // May need a new page if close to bottom
    if (doc.y > 580) doc.addPage();

    doc.fillColor(BRAND_DARK).fontSize(13).font('Helvetica-Bold')
      .text('Detailed Findings', MARGIN, doc.y);
    doc.moveDown(0.5);

    for (const dim of dimensions) {
      if (!dim.finding) continue;
      if (doc.y > 660) doc.addPage();

      const sc2 = dim.score || 0;
      const col3 = scoreColor(sc2);

      doc.fillColor(col3).fontSize(10).font('Helvetica-Bold')
        .text(`${dim.label}  (${sc2}/100 · ${dim.weight} weight)`, MARGIN, doc.y);
      doc.fillColor('#475569').fontSize(9).font('Helvetica')
        .text(dim.finding, MARGIN + 10, doc.y + 1, { width: CONTENT_W - 10, lineGap: 2 });
      doc.moveDown(0.7);
    }

    // ── NEXT STEPS ────────────────────────────────────────────────────────
    if (doc.y > 600) doc.addPage();
    doc.moveDown(0.5);

    // Accent band
    doc.rect(MARGIN, doc.y, CONTENT_W, 1).fill(BRAND_ACCENT);
    doc.moveDown(0.5);

    doc.fillColor(BRAND_DARK).fontSize(13).font('Helvetica-Bold')
      .text('Recommended Next Steps', MARGIN, doc.y);
    doc.moveDown(0.4);

    const steps = brief.pain_points?.length
      ? brief.pain_points.slice(0, 3)
      : [
          'Address the most critical content gap identified above to improve first impressions',
          'Improve conversion paths so website visitors have a clear next action',
          'Strengthen trust signals with client testimonials and case studies',
        ];

    steps.forEach((step, i) => {
      doc.fillColor(BRAND_ACCENT).fontSize(10).font('Helvetica-Bold')
        .text(`${i + 1}.`, MARGIN, doc.y, { continued: true, width: 15 });
      doc.fillColor('#334155').font('Helvetica')
        .text(` ${step}`, { width: CONTENT_W - 15 });
      doc.moveDown(0.3);
    });

    // ── CTA FOOTER ────────────────────────────────────────────────────────
    if (doc.y > 650) doc.addPage();

    const footerY = Math.max(doc.y + 20, 700);
    doc.rect(MARGIN, footerY, CONTENT_W, 80).fill(BRAND_MID);

    doc.fillColor(TEXT_PRIMARY).fontSize(12).font('Helvetica-Bold')
      .text('Want to fix these gaps? Let\'s talk.', MARGIN + 16, footerY + 14, { width: CONTENT_W - 32 });

    doc.fillColor(TEXT_MUTED).fontSize(9).font('Helvetica')
      .text(
        `${senderName} from ${senderCompany} helps Houston businesses solve exactly these issues with managed IT and AI automation. ` +
        `Reply to this email to schedule a free 15-minute strategy call.`,
        MARGIN + 16, footerY + 32, { width: CONTENT_W - 32, lineGap: 2 }
      );

    if (senderEmail) {
      doc.fillColor(BRAND_ACCENT).fontSize(9)
        .text(senderEmail, MARGIN + 16, footerY + 62);
    }

    doc.end();
  });
}

module.exports = { generateAuditReportPDF };
