# Deployment Guide for Replit

This guide will walk you through deploying the Web Transcriber & Summarizer application on Replit.

## Prerequisites

Before deploying, ensure you have:
- A Replit account
- An OpenAI API key
- Your project code ready for upload

## Step 1: Create a New Repl

1. Go to [Replit](https://replit.com) and sign in
2. Click "Create Repl" or the "+" button
3. Select "Import from GitHub" if your code is already on GitHub, or "Upload files" to upload your project
4. If importing from GitHub, enter your repository URL: `https://github.com/JMBartelt/web-transcriber-summarizer`
5. Name your Repl (e.g., "web-transcriber-summarizer")
6. Select "Node.js" as the language/template

## Step 2: Configure Environment Variables

Replit uses Secrets for environment variables:

1. In your Repl, click on the "Secrets" tab (lock icon) in the left sidebar
2. Add the following secret:
   - **Key**: `OPENAI_API_KEY`
   - **Value**: Your OpenAI API key (starts with `sk-`)

## Step 3: Project Structure Verification

Ensure your project has the following structure:
```
/
├── server.js (main server file)
├── package.json
├── index.js
├── public/
│   ├── index.html
│   └── main.js
├── lib/ (wavtools library)
├── uploads/ (will be created automatically)
└── .env (optional, Replit uses Secrets instead)
```

## Step 4: Configure package.json

Your `package.json` should include these essential configurations:

```json
{
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "dotenv": "^16.5.0",
    "express": "^5.1.0",
    "form-data": "^4.0.3",
    "multer": "^2.0.1",
    "node-fetch": "^3.3.2",
    "openai": "^5.5.1"
  }
}
```

## Step 5: Create .replit Configuration File

Create a `.replit` file in your project root:

```toml
run = "npm start"
modules = ["nodejs-20"]

[deployment]
run = ["sh", "-c", "npm start"]

[[ports]]
localPort = 3000
externalPort = 80
```

## Step 6: Install Dependencies

1. In the Replit Shell, run:
   ```bash
   npm install
   ```

## Step 7: Test Locally in Replit

1. Click the "Run" button in Replit
2. The application should start and be accessible via the preview pane
3. Test the recording and transcription functionality
4. Verify that audio uploads are working correctly

## Step 8: Deploy to Production

### Option A: Replit Deployments (Recommended)

1. Click on the "Deploy" tab in your Repl
2. Click "Deploy" to create a production deployment
3. Choose a subdomain or connect a custom domain
4. Your app will be deployed and accessible at `https://your-subdomain.replit.app`

### Option B: Always-On Repl

1. Go to your Repl settings
2. Enable "Always On" (requires a paid Replit plan)
3. Your Repl will continue running even when you close the browser

## Production Considerations

### Security
- Never commit your `.env` file or API keys to version control
- Use Replit Secrets for all sensitive environment variables
- Consider implementing rate limiting for production use

### File Upload Handling
- The `uploads/` directory is used for temporary file storage
- Files are automatically cleaned up after transcription
- Consider implementing file size limits for production

### Error Handling
- Monitor the console for any errors
- Implement proper error logging for production debugging
- Consider adding health check endpoints

### Performance
- The current implementation processes audio in 1-minute chunks
- For high-traffic scenarios, consider implementing queue management
- Monitor OpenAI API usage and rate limits

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key for Whisper transcription and GPT summarization |
| `PORT` | No | Server port (defaults to 3000, Replit will override this) |

## API Endpoints

- `GET /` - Serves the main application interface
- `POST /api/transcribe` - Transcribes audio files using OpenAI Whisper
- `POST /api/summarize` - Generates SOAP note summaries using GPT

## Troubleshooting

### Common Issues

1. **"Missing OPENAI_API_KEY" Error**
   - Ensure you've added your API key to Replit Secrets
   - Verify the key starts with `sk-` and is valid

2. **Module Import Errors**
   - Ensure `"type": "module"` is in your `package.json`
   - Verify all imports use `.js` file extensions

3. **Audio Recording Not Working**
   - Ensure the app is served over HTTPS (Replit deployments use HTTPS by default)
   - Check browser permissions for microphone access

4. **File Upload Issues**
   - Verify the `uploads/` directory exists and is writable
   - Check file size limits (multer default is 1MB)

### Debug Mode

To enable additional logging, add this to your Replit Secrets:
- **Key**: `NODE_ENV`
- **Value**: `development`

## Support

If you encounter issues:
1. Check the Replit console for error messages
2. Verify your OpenAI API key is valid and has sufficient credits
3. Ensure all dependencies are properly installed
4. Check the browser console for client-side errors

## Cost Considerations

- OpenAI API usage will incur costs based on:
  - Whisper transcription: ~$0.006 per minute of audio
  - GPT-4 summarization: varies by token usage
- Replit costs:
  - Free tier available with limitations
  - Paid plans for Always-On deployments and custom domains

Your application should now be successfully deployed and accessible via your Replit deployment URL!