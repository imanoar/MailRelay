import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDomainName,
  isValidDomainName,
  isValidLocalPart,
  buildDomainDnsSpec,
  computeDomainStatus,
  extractVerificationArtifacts,
  parseEmailAddress,
  stripSubaddressTag,
  formatRemainingTtl,
} from './mailEngine';

test('normalizeDomainName and isValidDomainName validate custom domains accurately', () => {
  assert.equal(normalizeDomainName('  HTTPS://QA.Acme-Testing.io/path '), 'qa.acme-testing.io');
  assert.equal(normalizeDomainName('@mail.dev-project.org'), 'mail.dev-project.org');
  assert.equal(isValidDomainName('qa.acme-testing.io'), true);
  assert.equal(isValidDomainName('auth.staging.company.co.uk'), true);
  assert.equal(isValidDomainName('invalid_domain'), false);
  assert.equal(isValidDomainName('-bad.com'), false);
  assert.equal(isValidDomainName(''), false);
});

test('isValidLocalPart validates inbox prefixes and subaddresses', () => {
  assert.equal(isValidLocalPart('auth-runner-01'), true);
  assert.equal(isValidLocalPart('user.name+e2e'), true);
  assert.equal(isValidLocalPart('..invalid'), false);
  assert.equal(isValidLocalPart('bad space'), false);
});

test('buildDomainDnsSpec and computeDomainStatus manage DNS verification state', () => {
  const records = buildDomainDnsSpec('qa.acme.dev', 'mr1', 'tok_9876543210abcdef1234567890', false);
  assert.equal(records.length, 4);
  assert.equal(computeDomainStatus(records), 'pending');

  records[0].verified = true;
  assert.equal(computeDomainStatus(records), 'partial');

  for (const rec of records) rec.verified = true;
  assert.equal(computeDomainStatus(records), 'verified');
});

test('extractVerificationArtifacts extracts 6-digit OTPs, hyphenated codes, and magic links without year false positives', () => {
  const subject = 'Your verification code is 849204';
  const textBody = 'Copyright 2026 Acme Inc. Use security code 849204 or backup token K9M-42P to sign in at https://auth.acme.dev/verify?token=abc999.';
  const htmlBody = `
    <div>
      <p>Your one-time passcode is <strong>849204</strong>.</p>
      <a href="https://auth.acme.dev/verify?token=abc999">Confirm Email Address</a>
      <a href="https://acme.dev/unsubscribe">Unsubscribe</a>
    </div>
  `;

  const result = extractVerificationArtifacts(subject, textBody, htmlBody);
  assert.equal(result.primaryOtp, '849204');
  assert.equal(result.otpCodes.includes('849204'), true);
  assert.equal(result.otpCodes.includes('K9M-42P'), true);
  assert.equal(result.otpCodes.includes('2026'), false);
  assert.equal(result.verificationLinks.length, 1);
  assert.equal(result.verificationLinks[0].url, 'https://auth.acme.dev/verify?token=abc999');
  assert.equal(result.verificationLinks[0].label, 'Confirm Email Address');
});

test('parseEmailAddress and stripSubaddressTag parse sender and recipient headers', () => {
  const parsed = parseEmailAddress('"Auth0 Security" <no-reply@auth.acme.dev>');
  assert.equal(parsed.name, 'Auth0 Security');
  assert.equal(parsed.address, 'no-reply@auth.acme.dev');
  assert.equal(parsed.domain, 'auth.acme.dev');

  const tagResult = stripSubaddressTag('signup-test+run42');
  assert.equal(tagResult.baseLocalPart, 'signup-test');
  assert.equal(tagResult.tag, 'run42');
});

test('formatRemainingTtl computes countdown strings accurately', () => {
  const now = 1_700_000_000_000;
  const future45m = new Date(now + 45 * 60 * 1000).toISOString();
  const res = formatRemainingTtl(future45m, now);
  assert.equal(res.expired, false);
  assert.equal(res.label, '45m 00s');

  const past = new Date(now - 5000).toISOString();
  assert.equal(formatRemainingTtl(past, now).expired, true);
});

test('parseRawMimeEmail and normalizeInboundPayload decode Cloudflare Email Worker MIME payloads and extract OTPs', async () => {
  const { buildRawMimeMessage, parseRawMimeEmail, normalizeInboundPayload, extractVerificationArtifacts } = await import('./mailEngine');

  const rawMime = buildRawMimeMessage({
    messageId: 'cf-worker-99',
    from: '"Cloudflare Edge" <noreply@notify.acme.dev>',
    to: 'signup-check@qa.acme-testing.dev',
    subject: 'Your Cloudflare Worker OTP is 904218',
    textBody: 'Your security code is 904218. Link: https://app.acme.dev/verify?code=904218',
    htmlBody: '<p>Your security code is <strong>904218</strong>. <a href="https://app.acme.dev/verify?code=904218">Verify Now</a></p>',
    receivedAt: new Date().toISOString(),
  });

  const parsed = parseRawMimeEmail(rawMime);
  assert.equal(parsed.subject, 'Your Cloudflare Worker OTP is 904218');
  assert.equal(parsed.textBody.includes('904218'), true);
  assert.equal(parsed.htmlBody.includes('<strong>904218</strong>'), true);

  const normalized = normalizeInboundPayload({
    provider: 'cloudflare-worker',
    to: 'signup-check@qa.acme-testing.dev',
    from: 'noreply@notify.acme.dev',
    rawMime,
  });

  assert.equal(normalized.provider, 'cloudflare-worker');
  assert.equal(normalized.subject, 'Your Cloudflare Worker OTP is 904218');

  const artifacts = extractVerificationArtifacts(
    normalized.subject,
    normalized.textBody,
    normalized.htmlBody
  );
  assert.equal(artifacts.primaryOtp, '904218');
  assert.equal(artifacts.verificationLinks[0].url, 'https://app.acme.dev/verify?code=904218');
});

test('sanitizeAndWrapEmailHtml strips scripts and inline handlers while buildEmlFilename formats safe EML filenames', async () => {
  const { sanitizeAndWrapEmailHtml, buildEmlFilename } = await import('./mailEngine');

  const dirtyHtml = `<div><script>alert("xss")</script><img src="x" onerror="steal()"><a href="javascript:evil()">Bad</a><p>Safe Code: <strong>123456</strong></p></div>`;
  const wrapped = sanitizeAndWrapEmailHtml(dirtyHtml);

  assert.equal(wrapped.includes('<script>'), false);
  assert.equal(wrapped.includes('onerror='), false);
  assert.equal(wrapped.includes('javascript:'), false);
  assert.equal(wrapped.includes('<base target="_blank"'), true);
  assert.equal(wrapped.includes('<strong>123456</strong>'), true);

  const filename = buildEmlFilename('Verify Your Account #42!', 'msg-9910');
  assert.equal(filename, 'verify-your-account-42-msg-9910.eml');
});

test('scanMessageForOtpTokens automatically scans incoming message bodies for 4-8 digit OTP codes', async () => {
  const { scanMessageForOtpTokens } = await import('./mailEngine');

  const textBody = 'Use PIN 4829 or backup token 19482738 (fallback: 8492014) to complete sign-in on 2026-10-25. © 2026 MailRelay.';
  const htmlBody = '<div style="width: 4800px"><p>Secondary 5-digit code: <b>59301</b> and 6-digit OTP: <span>739104</span></p></div>';
  const subject = 'Login verification';

  const tokens = scanMessageForOtpTokens(textBody, htmlBody, subject);
  assert.deepEqual(tokens, ['4829', '19482738', '59301', '739104', '8492014']);
  assert.equal(tokens.includes('2026'), false);
  assert.equal(tokens.includes('4800'), false);
});
