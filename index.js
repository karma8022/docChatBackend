const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const { GooglePaLMEmbeddings } = require("@langchain/community/embeddings/googlepalm");
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const app = express();
const port = 8001;


// Middleware
app.use(cors());
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });

async function extractText(buffer) {
    try {
        const textContent = buffer.toString('utf8');
        console.log("File read successfully from buffer");
        return textContent;
    } catch (error) {
        console.error('Error reading from buffer:', error);
        throw new Error('Error processing buffer.');
    }
}

async function extractText(buffer) {
    try {
        const textContent = buffer.toString('utf8');
        console.log("File read successfully from buffer");
        return textContent;
    } catch (error) {
        console.error('Error reading from buffer:', error);
        throw new Error('Error processing buffer.');
    }
}

// MongoDB setup
const mongoUri = 'mongodb+srv://aaron:Aaron123@cluster0.0ufwbae.mongodb.net/?retryWrites=true&w=majority'; // Replace with your MongoDB URI
const client = new MongoClient(mongoUri);
const dbName = 'Cluster0'; // Your MongoDB database name
const collectionName = 'documents'; // Your MongoDB collection name

// Configure Axios for external APIs
const pineconeAxios = axios.create({
    baseURL: "https://palm-bff4931.svc.gcp-starter.pinecone.io", // Replace with your Pinecone base URL
    headers: {
        'Api-Key': "68220ca2-cb3b-4952-bc99-62990dcfbd38", // Replace with your Pinecone API key
        'Content-Type': 'application/json'
    }
});

const huggingFaceAxios = axios.create({
    headers: {
        'Authorization': 'Bearer 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' // Replace with your Hugging Face API key
    }
});

// Function to generate text embeddings using Google PaLM API
async function generateTextEmbeddings(text) {
    try {
        const model = new GooglePaLMEmbeddings({
            apiKey: "AIzaSyBysL_SjXQkJ8lI1WPTz4VwyH6fxHijGUE", // Replace with your actual API key
            modelName: "models/embedding-gecko-001",
        });

        // Chunk the text
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 750,
        });
        const chunks = await textSplitter.createDocuments([text]);
        let embeddingsArrays = [];
        // Generate embeddings for each chunk
        for (let chunk of chunks) {
            const embeddings = await model.embedQuery(chunk.pageContent);
            embeddingsArrays = embeddings.map((embedding) => embedding.embedding);
            console.log(embeddings)
            console.log('_______________________________________________________________________')
            const batchSize = 750;
            let batch = [];
            for (let idx = 0; idx < chunks.length; idx++) {
            const chunk = chunks[idx];
            const vector = {
                id: `${idx}`,
                values: embeddingsArrays[idx],
                metadata: {
                ...chunk.metadata,
                pageContent: chunk.pageContent,
                },
            };
            batch.push(vector);
        }   
    } 
    console.log(embeddingsArrays);
    return embeddingsArrays;
    } catch (error) {
        console.error('Error generating text embeddings:', error);
        throw new Error('Error generating text embeddings.');
    }
}


// Function to search in Pinecone based on embeddings and retrieve metadata
async function searchInPinecone(embeddings) {
    try {
        const response = await pineconeAxios.post('/query', {
            namespace: 'your-namespace', // Replace with your actual namespace
            vector: embeddings,
            topK: 5, // Adjust based on how many results you want
            includeMetadata: true // Ensure metadata is included in the response
        });
        return response.data;
    } catch (error) {
        console.error('Error searching in Pinecone:', error);
        throw new Error('Error performing search.');
    }
}

// Function to fetch document texts from MongoDB using their IDs
async function getTextsFromMongoDB(documentIds) {
    let texts = [];
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        
        for (let documentId of documentIds) {
            const document = await collection.findOne({ _id: new ObjectId(documentId) });
            if (document !== null) {
                texts.push(document.text); // Assuming the text is stored under the "text" field
            } else {
                console.log(`No document found for ID: ${documentId}`);
                // Optionally handle the case where the document is not found, e.g., by pushing a placeholder or skipping
            }
        }
    } catch (error) {
        console.error('Error fetching text from MongoDB:', error);
        throw error;
    } finally {
        await client.close();
    }
    return texts;
}

// Function to generate a contextual answer using Hugging Face
async function generateContextualAnswer(context, question) {
    try {
        const payload = {
            inputs: {
                question: question,
                context: context
            }
        };

        const response = await huggingFaceAxios.post(
            "https://api-inference.huggingface.co/models/bert-large-uncased-whole-word-masking-finetuned-squad",
            payload
        );

        return response.data.answer;
    } catch (error) {
        console.error('Error generating answer with Hugging Face:', error.response?.data || error.message);
        throw new Error('Failed to generate answer with Hugging Face.');
    }
}

async function saveTextToMongoDB(text, title) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const result = await collection.insertOne({ text, title });
        console.log(`File saved to MongoDB with _id: ${result.insertedId}`);
        return result.insertedId;
    } catch (error) {
        console.error("Error saving file to MongoDB:", error);
        throw error; // Rethrow or handle error as appropriate
    } finally {
        await client.close();
    }
}

// Main function to perform a semantic search and display results
async function performSemanticSearch(query) {
    const embeddings = await generateTextEmbeddings(query);
    const searchResults = await searchInPinecone(embeddings);

    const documentIds = searchResults.matches.map(match => match.id);
    const documentsText = await getTextsFromMongoDB(documentIds);

    if (documentsText.length > 0) {
        const context = documentsText.join(' '); // Concatenate all texts to form a single context
        const answer = await generateContextualAnswer(context, query);
        return answer;
    } else {
        return 'No documents found for the query.';
    }
}

// POST endpoint to perform semantic search
app.post('/performSemanticSearch', async (req, res) => {
    const { query } = req.body;
    try {
        const answer = await performSemanticSearch(query);
        res.json({ answer });
    } catch (error) {
        console.error('Error handling performSemanticSearch:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        // Now using the buffer directly from the uploaded file
        const buffer = req.file.buffer;
        const text = await extractText(buffer);
        const title= req.file.originalname;
        const embeddings = await generateTextEmbeddings(text);
        const mongoDocumentId = await saveTextToMongoDB(text,title);
        const vectorId = mongoDocumentId.toString();

        // Upload the embeddings to Pinecone with the MongoDB document ID as a reference
        const pineconeResponse = await pineconeAxios.post('/vectors/upsert', {
            namespace: 'your-namespace', // Replace with your actual namespace
            vectors: [{
                id: vectorId,
                values: embeddings,
            }],
        });

        res.json({
            message: 'Document and embeddings successfully uploaded.',
            mongoDocumentId: mongoDocumentId,
            pineconeResponse: pineconeResponse.data
        });
        console.log('Upload to pinecone complete.');
    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).send('Error processing upload.');
    }
});

app.get('/api/files', async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        // Fetch both the title and text attributes, excluding _id
        const documents = await collection.find({}, { projection: { title: 1, text: 1, _id: 0 } }).toArray();

        res.json(documents);
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        await client.close();
    }
});




app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});