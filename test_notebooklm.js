// Script de prueba local para la integración de NotebookLM
import { spawn } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

function askNotebookLM(notebookId, prompt, conversationId = null) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', ['src/scripts/notebooklm_helper.py']);
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python process exited with code ${code}. Stderr: ${stderrData}`));
      }
      try {
        const result = JSON.parse(stdoutData.trim());
        if (result.error) {
          return reject(new Error(result.error));
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse Python stdout: ${stdoutData}. Error: ${err.message}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });

    // Write input JSON to stdin
    const inputPayload = JSON.stringify({
      notebook_id: notebookId,
      conversation_id: conversationId,
      prompt: prompt
    });
    pythonProcess.stdin.write(inputPayload);
    pythonProcess.stdin.end();
  });
}

async function runTest() {
  const notebookId = process.env.TEST_NOTEBOOK_ID;
  if (!notebookId) {
    console.error('ERROR: Define TEST_NOTEBOOK_ID en tu archivo .env para correr esta prueba.');
    process.exit(1);
  }

  const cookies = process.env.NOTEBOOKLM_COOKIES;
  if (!cookies) {
    console.error('ERROR: Define NOTEBOOKLM_COOKIES en tu archivo .env para correr esta prueba.');
    process.exit(1);
  }

  console.log('Iniciando prueba de conexión con NotebookLM...');
  console.log(`Notebook ID: ${notebookId}`);
  console.log('Prompt: "¿Quién eres y qué información tienes?"');

  try {
    const response = await askNotebookLM(notebookId, '¿Quién eres y qué información tienes?');
    console.log('\n--- RESPUESTA EXITOSA DE NOTEBOOKLM ---');
    console.log(response.answer);
    console.log('---------------------------------------');
    console.log(`ID de Conversación generado: ${response.conversation_id}`);
    
    console.log('\nIntentando segundo turno de conversación en el mismo hilo...');
    const followUpResponse = await askNotebookLM(notebookId, 'Resume en una línea lo que me acabas de decir.', response.conversation_id);
    console.log('\n--- RESPUESTA SEGUNDO TURNO ---');
    console.log(followUpResponse.answer);
    console.log('--------------------------------');
    console.log(`ID de Conversación (debe ser el mismo): ${followUpResponse.conversation_id}`);
    console.log('Prueba finalizada con éxito.');
  } catch (error) {
    console.error('\n❌ ERROR EN LA PRUEBA:', error.message);
  }
}

runTest();
