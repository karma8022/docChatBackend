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

// MongoDB setup
const mongoUri = 'mongodb+srv://aaron:Aaron123@cluster0.0ufwbae.mongodb.net/?retryWrites=true&w=majority'; // Replace with your MongoDB URI
const client = new MongoClient(mongoUri);
const dbName = 'Cluster0'; // Your MongoDB database name
const collectionName = 'documents'; // Your MongoDB collection name

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

async function getTextsFromMongoDB(documentIds) {
    let texts = [];
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        let cleanedDocumentIds = documentIds.map(id => id.substring(0, id.lastIndexOf('_')));
        console.log(cleanedDocumentIds)
        for (let documentId of cleanedDocumentIds) {
            const document = await collection.findOne({ _id: new ObjectId(documentId) });
            if (document !== null) {
                texts.push(document.text); // Assuming the text is stored under the "text" field
                console.log('done');
            } else {
                console.log('No document found for ID:', `${documentId}`);
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
        console.log('File saved to MongoDB with _id:', `${result.insertedId}`);
        return result.insertedId;
    } catch (error) {
        console.error("Error saving file to MongoDB:", error);
        throw error; // Rethrow or handle error as appropriate
    } finally {
        await client.close();
    }
}

async function performSemanticSearch(query) {
    console.log(query)
    const embeddings = await generateTextEmbeddingsQuery(query);
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

async function generateTextEmbeddings(text) {
    try {
        const model = new GooglePaLMEmbeddings({
            apiKey: "AIzaSyBysL_SjXQkJ8lI1WPTz4VwyH6fxHijGUE",
            modelName: "models/embedding-gecko-001",
        });

        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 50
        });
        const chunks = await textSplitter.createDocuments([text]);
        console.log(chunks)
        
        // Generate embeddings for each chunk
        const embeddingsPromises = chunks.map(chunk => model.embedQuery(chunk.pageContent));
        const embeddingsArrays = await Promise.all(embeddingsPromises);

        // Return the array of embeddings
        return embeddingsArrays;
    } catch (error) {
        console.error('Error generating text embeddings:', error);
        throw new Error('Error generating text embeddings.');
    }
}


async function generateTextEmbeddingsQuery(text) {
    try {
        const model = new GooglePaLMEmbeddings({
            apiKey: "AIzaSyBysL_SjXQkJ8lI1WPTz4VwyH6fxHijGUE", // Replace with your actual API key
            modelName: "models/embedding-gecko-001",
        });

        const embeddings = await model.embedQuery(text);
        console.log(embeddings)
        return embeddings;
    } catch (error) {
        console.error('Error generating text embeddings:', error);
        throw new Error('Error generating text embeddings.');
    }
}





app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        const buffer = req.file.buffer;
        const text = await extractText(buffer);
        const title = req.file.originalname;
        const embeddingsArrays = await generateTextEmbeddings(text);
        const mongoDocumentId = await saveTextToMongoDB(text, title);

        // Iterate over each embedding and upload separately
        for (const [index, embedding] of embeddingsArrays.entries()) {
            const vectorId = mongoDocumentId.toString(); // Unique ID for each embedding

            await pineconeAxios.post('/vectors/upsert', {
                namespace: 'your-namespace', // Ensure this matches your Pinecone config
                vectors: [{
                    id: vectorId,
                    values: embedding,
                }],
            });
        }
        console.log('Upload to pinecone complete.');
        res.json({
            message: 'Document and embeddings successfully uploaded.',
            mongoDocumentId: mongoDocumentId,
        });
    }  catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).send('Error processing upload.');
    }
});





app.listen(port, () => {
    console.log('Server running on port', `${port}`);
});