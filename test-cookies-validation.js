#!/usr/bin/env node

/**
 * Cookie Validation Script
 * 
 * Tests if your YouTube cookies are valid before deploying to Render
 * 
 * Usage:
 *   node test-cookies-validation.js ./test-cookies.json
 *   node test-cookies-validation.js ./cookies.txt
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const cookieFile = process.argv[2] || './test-cookies.json';

if (!fs.existsSync(cookieFile)) {
  console.error(`❌ Cookie file not found: ${cookieFile}`);
  console.log('\nUsage: node test-cookies-validation.js <cookie-file>');
  process.exit(1);
}

console.log('🔍 Validating YouTube cookies...\n');

// Read and parse cookies
let cookieContent = fs.readFileSync(cookieFile, 'utf8');
let cookies = [];
let format = 'unknown';

// Detect format
if (cookieFile.endsWith('.json')) {
  try {
    cookies = JSON.parse(cookieContent);
    format = 'json';
    console.log('✅ Format: JSON');
  } catch (e) {
    console.error('❌ Invalid JSON format');
    process.exit(1);
  }
} else {
  format = 'netscape';
  console.log('✅ Format: Netscape');
}

// Validate cookies
if (format === 'json') {
  console.log(`\n📊 Cookie Analysis:`);
  console.log(`   Total cookies: ${cookies.length}`);
  
  const now = Date.now() / 1000;
  const expired = cookies.filter(c => c.expirationDate && c.expirationDate < now);
  const valid = cookies.filter(c => !c.expirationDate || c.expirationDate >= now);
  
  console.log(`   Valid cookies: ${valid.length}`);
  console.log(`   Expired cookies: ${expired.length}`);
  
  if (expired.length > 0) {
    console.log(`\n⚠️  Expired cookies:`);
    expired.slice(0, 5).forEach(c => {
      const expDate = new Date(c.expirationDate * 1000).toISOString();
      console.log(`   - ${c.name} (expired: ${expDate})`);
    });
    if (expired.length > 5) {
      console.log(`   ... and ${expired.length - 5} more`);
    }
  }
  
  // Check for essential YouTube cookies
  const essential = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'];
  const missing = essential.filter(name => !valid.some(c => c.name === name));
  
  console.log(`\n🔑 Essential cookies:`);
  essential.forEach(name => {
    const found = valid.find(c => c.name === name);
    if (found) {
      const expDate = found.expirationDate ? new Date(found.expirationDate * 1000).toISOString() : 'session';
      console.log(`   ✅ ${name} (expires: ${expDate})`);
    } else {
      console.log(`   ❌ ${name} - MISSING`);
    }
  });
  
  if (missing.length > 0) {
    console.log(`\n⚠️  Warning: Missing essential cookies: ${missing.join(', ')}`);
    console.log('   YouTube downloads may fail without these cookies.');
  }
  
  if (valid.length === 0) {
    console.log('\n❌ ALL COOKIES ARE EXPIRED!');
    console.log('   Please export fresh cookies from your browser.');
    console.log('   See export-cookies.md for instructions.');
    process.exit(1);
  }
  
  // Convert to Netscape format for testing
  const netscapeCookies = "# Netscape HTTP Cookie File\n\n" + 
    valid.map(c => {
      const domain = c.domain || '.youtube.com';
      const includeSubDomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const path = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
      return `${domain}\t${includeSubDomains}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
    }).join('\n');
  
  const tempFile = './temp-cookies.txt';
  fs.writeFileSync(tempFile, netscapeCookies);
  console.log(`\n✅ Converted to Netscape format: ${tempFile}`);
  cookieFile = tempFile;
}

// Test with yt-dlp
console.log('\n🧪 Testing with yt-dlp...');
console.log('   URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ');

const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const ytdlp = spawn('yt-dlp', [
  '--cookies', cookieFile,
  '--dump-single-json',
  '--no-warnings',
  '--skip-download',
  '--extractor-args', 'youtube:player_client=android,web',
  testUrl
]);

let stdout = '';
let stderr = '';

ytdlp.stdout.on('data', (data) => {
  stdout += data.toString();
});

ytdlp.stderr.on('data', (data) => {
  stderr += data.toString();
});

ytdlp.on('close', (code) => {
  // Clean up temp file
  if (format === 'json' && fs.existsSync('./temp-cookies.txt')) {
    fs.unlinkSync('./temp-cookies.txt');
  }
  
  if (code === 0) {
    try {
      const jsonStart = stdout.indexOf('{');
      const data = JSON.parse(stdout.slice(jsonStart));
      console.log(`\n✅ SUCCESS! Cookies are working!`);
      console.log(`   Title: ${data.title}`);
      console.log(`   Duration: ${data.duration}s`);
      console.log(`   Uploader: ${data.uploader}`);
      console.log('\n🎉 Your cookies are valid and ready for Render!');
      console.log('\nNext steps:');
      console.log('1. Copy the content of your cookie file');
      console.log('2. Go to Render Dashboard → Environment');
      console.log('3. Set YOUTUBE_COOKIES = <paste cookie content>');
      console.log('4. Deploy and test!');
      process.exit(0);
    } catch (e) {
      console.log('\n⚠️  yt-dlp succeeded but returned unexpected data');
      console.log('Stdout:', stdout.slice(0, 200));
    }
  } else {
    console.log(`\n❌ FAILED! (exit code ${code})`);
    if (stderr) {
      console.log('\nError details:');
      console.log(stderr);
      
      if (stderr.includes('Sign in to confirm')) {
        console.log('\n💡 Tip: YouTube is asking for authentication.');
        console.log('   Your cookies may be invalid or expired.');
      } else if (stderr.includes('HTTP Error 400') || stderr.includes('Bad Request')) {
        console.log('\n💡 Tip: YouTube rejected the request (400 Bad Request).');
        console.log('   This is the same error you see on Render!');
        console.log('   Your cookies are likely expired or invalid.');
      } else if (stderr.includes('private') || stderr.includes('members-only')) {
        console.log('\n💡 Tip: This video requires authentication.');
        console.log('   Try a different public video.');
      }
    }
    
    console.log('\n📝 Recommendations:');
    console.log('1. Export fresh cookies from your browser (see export-cookies.md)');
    console.log('2. Make sure you are logged in to YouTube');
    console.log('3. Use the "Get cookies.txt LOCALLY" browser extension');
    console.log('4. Or use: yt-dlp --cookies-from-browser chrome --write-cookies cookies.txt <url>');
    process.exit(1);
  }
});

ytdlp.on('error', (error) => {
  console.error(`\n❌ Failed to run yt-dlp: ${error.message}`);
  console.log('\n💡 Make sure yt-dlp is installed:');
  console.log('   pip install yt-dlp');
  console.log('   or: brew install yt-dlp');
  process.exit(1);
});
