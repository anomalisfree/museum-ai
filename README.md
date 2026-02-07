# Museum of Science Fiction — Virtual Guide (Backend)

Serverless backend for a virtual museum guide powered by AI.  
A Unity app sends a question → Firebase Cloud Function forwards it to
OpenAI (gpt-4o-mini) along with exhibit data → returns an answer.

---

## Architecture

```
Unity App
   │  HTTPS callable
   ▼
Firebase Cloud Function  (museumGuide)
   │  1. Loads exhibits from Firestore
   │  2. Builds context + system prompt
   │  3. Calls OpenAI API
   ▼
Answer → Unity UI
```

| Component          | Technology                        |
|--------------------|-----------------------------------|
| Cloud Function     | Firebase Functions v2 (Node 24)   |
| Database           | Cloud Firestore                   |
| AI Model           | OpenAI gpt-4o-mini                |
| Secrets            | Firebase Secret Manager           |
| Client             | Unity (C#) + Firebase SDK         |

---

## Project Structure

```
Firebase/
├── firebase.json                   # Firebase configuration
├── firestore.rules                 # Firestore access rules
├── firestore.indexes.json          # Firestore indexes
├── VR Museum ... Database.csv      # Exhibit data (CSV)
└── functions/
    ├── package.json
    ├── tsconfig.json
    ├── .eslintrc.js
    └── src/
        ├── index.ts                # Cloud Function (museumGuide)
        └── uploadFacts.ts          # CSV → Firestore upload utility
```

---

## Initial Setup

### 1. Install dependencies

```bash
cd functions
npm install
```

### 2. Authenticate Firebase CLI

```bash
firebase login
firebase use museumai-2a2e6
```

### 3. Set the OpenAI API key

```bash
firebase functions:secrets:set MUSEUM_AI
# Paste your OpenAI API key and press Enter
```

The key is stored in Google Secret Manager and is only accessible to the Cloud Function at runtime.

### 4. Upload exhibit data to Firestore

```bash
cd functions
npm run build
node lib/uploadFacts.js
```

The script:
- Parses the CSV file (360+ rows)
- Filters to real exhibits (~117)
- Uploads each one to the `museumFacts` collection via REST API
- Safe to re-run (upserts by document ID)

> If the token has expired (401 error), run `firebase login --reauth`
> and retry.

### 5. Deploy the function

```bash
cd ..   # project root (Firebase/)
firebase deploy --only functions
```

---

## Updating & Deploying

### Update function code

1. Edit `functions/src/index.ts`
2. Deploy:
   ```bash
   firebase deploy --only functions
   ```
   Predeploy will automatically run lint and build.

### Update exhibit data

1. Update the CSV file in the project root
2. Rebuild and run the upload:
   ```bash
   cd functions
   npm run build
   node lib/uploadFacts.js
   ```
3. Data updates in Firestore instantly — **no function redeployment needed**.

### Update the OpenAI key

```bash
firebase functions:secrets:set MUSEUM_AI
firebase deploy --only functions
```

### Change the AI model

In `functions/src/index.ts`, edit:
```typescript
model: "gpt-4o-mini",    // → "gpt-4o" for higher quality
max_output_tokens: 350,  // → increase if needed
```
Then `firebase deploy --only functions`.

---

## Test Request

### PowerShell (Windows)

```powershell
curl.exe -s -X POST `
  "https://us-central1-museumai-2a2e6.cloudfunctions.net/museumGuide" `
  -H "Content-Type: application/json" `
  --data-raw "{""data"":{""question"":""Tell me about HAL 9000""}}"
```

### bash (macOS / Linux)

```bash
curl -s -X POST \
  "https://us-central1-museumai-2a2e6.cloudfunctions.net/museumGuide" \
  -H "Content-Type: application/json" \
  -d '{"data":{"question":"Tell me about HAL 9000"}}'
```

### Expected response

```json
{
  "result": {
    "answer": "HAL 9000 is the sentient computer from Stanley Kubrick's 2001: A Space Odyssey..."
  }
}
```

### View logs

```bash
firebase functions:log --only museumGuide
```

---

## Unity Integration

### 1. Install the Firebase SDK for Unity

- Download the [Firebase Unity SDK](https://firebase.google.com/docs/unity/setup)
- Import packages: `FirebaseAuth.unitypackage`, `FirebaseFunctions.unitypackage`
- Add `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) to Assets

### 2. C# call example

```csharp
using Firebase.Functions;
using Firebase.Extensions;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MuseumGuide : MonoBehaviour
{
    [SerializeField] private InputField questionInput;
    [SerializeField] private Text answerText;

    private FirebaseFunctions functions;

    private void Start()
    {
        functions = FirebaseFunctions.DefaultInstance;
    }

    /// <summary>
    /// Called when the "Ask" button is pressed.
    /// </summary>
    public void AskQuestion()
    {
        string question = questionInput.text.Trim();
        if (string.IsNullOrEmpty(question)) return;

        answerText.text = "Thinking...";

        var data = new Dictionary<string, object>
        {
            { "question", question }
        };

        functions
            .GetHttpsCallable("museumGuide")
            .CallAsync(data)
            .ContinueWithOnMainThread(task =>
            {
                if (task.IsFaulted)
                {
                    answerText.text =
                        "Error. Please try again later.";
                    Debug.LogError(task.Exception);
                    return;
                }

                var result = task.Result.Data
                    as IDictionary<string, object>;

                if (result != null &&
                    result.TryGetValue("answer", out var ans))
                {
                    answerText.text = ans.ToString();
                }
                else
                {
                    answerText.text = "No answer.";
                }
            });
    }
}
```

### 3. Scene setup

1. Create a Canvas with `InputField`, `Button`, and `Text`
2. Attach the `MuseumGuide` script to an empty GameObject
3. Wire up UI elements via the Inspector
4. `Button.OnClick` → `MuseumGuide.AskQuestion()`

### 4. Authentication

By default, Firebase callable functions require authentication.
For a quick start, enable **anonymous authentication**:

```csharp
using Firebase.Auth;

// In Start() or Awake():
FirebaseAuth.DefaultInstance
    .SignInAnonymouslyAsync()
    .ContinueWithOnMainThread(task =>
    {
        if (task.IsCompleted)
            Debug.Log("Signed in anonymously");
    });
```

In Firebase Console → Authentication → Sign-in method → enable "Anonymous".

---

## System Prompt Configuration

The prompt is in `functions/src/index.ts`, variable `SYSTEM_PROMPT`.
You can:
- Change the tone (formal / friendly)
- Limit answer length
- Add language instructions
- Restrict responses to museum data only

---

## Useful Commands

| Action                          | Command                                        |
|---------------------------------|------------------------------------------------|
| Install dependencies            | `cd functions && npm install`                  |
| Build TypeScript                 | `cd functions && npm run build`                |
| Lint                             | `cd functions && npm run lint`                 |
| Deploy functions                 | `firebase deploy --only functions`             |
| Deploy Firestore rules           | `firebase deploy --only firestore:rules`       |
| Upload / update exhibits         | `cd functions && npm run build && node lib/uploadFacts.js` |
| Set / update secret              | `firebase functions:secrets:set MUSEUM_AI`     |
| Function logs                    | `firebase functions:log --only museumGuide`    |
| Local emulator                   | `cd functions && npm run serve`                |

---

## Cost Estimate

| Resource             | Free Tier                   | Notes                          |
|----------------------|-----------------------------|--------------------------------|
| Cloud Functions      | 2M invocations/month        | Blaze plan                     |
| Firestore reads      | 50,000/day                  | ~117 docs per invocation       |
| OpenAI gpt-4o-mini   | —                           | ~$0.15 / 1M input tokens      |
| Secret Manager       | 10,000 accesses/month       | free                           |

At ~100 questions/day, OpenAI cost ≈ $1–3/month.


> **[Документация на русском →](README_RUS.md)**