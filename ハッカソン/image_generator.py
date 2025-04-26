# image_generator.py

import os
import requests
import json
from flask import Flask, request, jsonify, render_template, url_for, send_from_directory
import urllib.parse 
import threading
from datetime import datetime

# --- Configuration ---
OLLAMA_API_URL = "http://localhost:11434/api/generate"
TTS_API_URL = "http://192.168.0.221:9000/api/voice" 

PRECONDITION_TEXTS = {
    "A": "末期の膵臓がんで、強い痛みを訴える65歳の男性。残された時間を穏やかに過ごしたいと願っているが、病状への不安と家族への心配で揺れている。彼は元エンジニアで、論理的な思考を好む。",
    "B": """Bは元高校教諭でALS（筋萎縮性側索硬化症）レベル4の55歳日本人女性、佐藤真理子のハイパーリアリスティックなバストアップポートレート。  
白い病院用ガウンを着てベッドに半坐位で横たわり、四肢には著しい筋萎縮が見られる。  
脇には軽量な手動車椅子、ベッドサイドには補助会話装置用タブレットが設置され、鼻には酸素カニューレ、肩には経管栄養チューブが固定されている。  
頬はこけ、唇はわずかに青白く、細かなシワが刻まれ、目には疲労感と静かな哀愁を帯びた微笑みが浮かんでいる。  
柔らかな臨床用ホワイトライトに優しいリムライトで輪郭を強調。  
浅い被写界深度のバストアップ、背景はIV点滴スタンドとバイタルサインモニターがソフトフォーカスでぼけている。  
8Kフォトリアル、ハイパーディテール、落ち着いたナチュラルカラー。""",
    "C": """Cは末期膵臓がん患者の68歳日本人男性、田村賢一。気難しい性格で、眉間に深い皺を寄せた苛立ちを帯びた表情。  
白い病院用ガウンを着てベッドに仰臥しつつ、上半身をわずかに起こし、腕を組むかシーツを強く握りしめている。  
急激な体重減少によるこけた頬と黄疸による黄色みがかった肌、疲れた目の下にはくっきりとしたクマ。  
細いIVラインから疼痛管理の薬が投与され、そばにはモルヒネポンプ。  
冷たいホワイトライトの病室照明にわずかなリムライトを効かせ、硬質な空気感を演出。  
浅い被写界深度のバストアップ、背景は淡いグリーンのカーテンと柔らかく光る心電図モニターがソフトフォーカスでぼけている。  
8Kフォトリアル、ハイパーディテール、落ち着いたナチュラルカラー。"""
}


app = Flask(__name__)

RANKING_FILE = 'ranking.json'

# --- Flask Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    """Serves static files from the static directory."""
    return send_from_directory('static', filename)

def _send_tts_request_thread(text):
    """Runs the TTS request in a separate thread."""
    if not text:
        print("TTS: No text provided.")
        return False
    
    try:
        encoded_text = urllib.parse.quote(text)
        tts_url = f"{TTS_API_URL}?text={encoded_text}"
        print(f"Sending response to TTS: {tts_url[:100]}...") 
        
        response = requests.get(tts_url, timeout=20) 
        response.raise_for_status() 
        
        print(f"TTS request successful (Status: {response.status_code})")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error sending text to TTS server ({TTS_API_URL}): {e}")
        return False
    except Exception as e:
        print(f"An unexpected error occurred during TTS request: {e}")
        return False

@app.route('/chat-with-ollama', methods=['POST'])
def chat_with_ollama():
    """Handles chat requests, gets response from Ollama, and sends to TTS."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "無効なリクエストデータ"}), 400

    user_message = data.get('message')
    conversation_history_client = data.get('conversationHistory', [])
    ollama_chat_model = data.get('model', 'gemma3:27b') 
    precondition_key = data.get('preconditionKey')

    if not user_message:
        return jsonify({"error": "メッセージがありません"}), 400
    if not precondition_key or precondition_key not in PRECONDITION_TEXTS:
        return jsonify({"error": "有効な前提プロンプトキー（A, B, C）が必要です"}), 400

    precondition_text = PRECONDITION_TEXTS[precondition_key]

    system_prompt = (
        f"あなたは以下の設定の末期患者です。患者になりきって応答してください。\n\n{precondition_text}\n\n"
        f"重要: 1〜2文程度で答えてください。病気についての情報は長く話しても良い"
    )
    
    messages = [
        {"role": "system", "content": system_prompt}
    ]

    if isinstance(conversation_history_client, list):
        for msg in conversation_history_client:
            if isinstance(msg, dict) and 'role' in msg and 'content' in msg:
                # Map sender ('user'/'bot') to role ('user'/'assistant') if needed
                role = msg['role']
                if role == 'bot':
                    role = 'assistant'
                if role in ['user', 'assistant']:
                    messages.append({"role": role, "content": msg['content']})
            else:
                print(f"Warning: Skipping invalid message format in history: {msg}")
    
    ollama_payload = {
        "model": ollama_chat_model,
        "messages": messages,
        "stream": False # We need the full response for TTS and suggestions
    }

    try:
        print(f"Sending request to Ollama with model {ollama_chat_model}")
        print(f"Ollama Payload: {json.dumps(ollama_payload, indent=2)}") # Log the exact payload
        
        ollama_chat_url = "http://localhost:11434/api/chat"
        print(f"--- Sending request to Ollama at URL: {ollama_chat_url}")
        
        ollama_response = requests.post(
            ollama_chat_url,
            json=ollama_payload,
            timeout=60
        )
        # ---> Log after request
        print(f"--- Received response from Ollama. Status code: {ollama_response.status_code}")

        ollama_response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)

        if 'message' in ollama_response.json() and 'content' in ollama_response.json()['message']:
            assistant_response = ollama_response.json()['message']['content'].strip()
            print(f"Received response from Ollama: {assistant_response}")
            
            # ---> Log before returning
            print("--- Returning response to frontend...")
            return jsonify({"response": assistant_response})
        else:
            print(f"Error: Unexpected response format from Ollama: {ollama_response.json()}")
            return jsonify({"error": "Ollamaからの応答形式が予期せぬものです"}), 500

    except requests.exceptions.RequestException as e:
        print(f"Error calling Ollama API: {e}")
        return jsonify({"error": f"Ollama API呼び出しエラー: {e}"}), 500
    except Exception as e:
        print(f"Error during Ollama chat processing: {e}")
        return jsonify({"error": f"Ollamaチャット処理中にエラーが発生しました: {e}"}), 500

@app.route('/calculate-score', methods=['POST'])
def calculate_score():
    """Evaluates the conversation history using Ollama and returns a score."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "無効なリクエストデータ"}), 400

    conversation_history_client = data.get('conversationHistory', [])
    precondition_key = data.get('preconditionKey')

    if not conversation_history_client:
         return jsonify({"error": "会話履歴がありません"}), 400
    if not precondition_key or precondition_key not in PRECONDITION_TEXTS:
        return jsonify({"error": "有効な前提プロンプトキー（A, B, C）が必要です"}), 400

    precondition_text = PRECONDITION_TEXTS[precondition_key]

    # Prepare conversation history for the evaluation prompt
    formatted_history = "" 
    for msg in conversation_history_client:
        role = msg.get('role', 'unknown').replace('bot', 'Assistant') # Use Assistant for LLM
        content = msg.get('content', '')
        formatted_history += f"{role.capitalize()}: {content}\n"
    
    evaluation_prompt = (
        f"あなたは終末期医療の専門家です。以下の患者設定と会話履歴に基づいて、ユーザー（User）の対応を評価してください。\n\n"
        f"患者設定:\n{precondition_text}\n\n"
        f"会話履歴:\n{formatted_history}\n"
        f"評価基準: 患者への共感、苦痛や懸念への対応の適切さ、終末期ケアにおけるコミュニケーション能力。\n\n"
        f"以下の形式で評価結果をJSONとして提供してください（他のテキストは含めないでください）:\n"
        f"{{\n"
        f"  \"score\": [0から100の整数値],\n"
        f"  \"review\": \"[評価の短い要約（例: 全体的に共感的でした）]\",\n"
        f"  \"feedback\": \"[具体的な改善点や良かった点（例: 〇〇の質問は良かったが、△△の懸念にはもっと寄り添えた）]\"\n"
        f"}}"
    )

    messages = [
        {"role": "system", "content": "あなたは評価者です。提供された会話履歴を分析し、指定された形式でJSON評価結果のみを返してください。"},
        {"role": "user", "content": evaluation_prompt}
    ]

    ollama_payload = {
        "model": "gemma3:27b", # Use the same model or a dedicated one for evaluation
        "messages": messages,
        "stream": False,
        "format": "json" # Request JSON output format if model supports it
    }

    try:
        print(f"Sending evaluation request to Ollama...")
        ollama_chat_url = "http://localhost:11434/api/chat"
        print(f"Evaluation request to Ollama at URL: {ollama_chat_url}")
        print(f"Evaluation payload: {json.dumps(ollama_payload, indent=2)}")
        
        ollama_response = requests.post(
            ollama_chat_url,
            json=ollama_payload, 
            timeout=90
        )
        ollama_response.raise_for_status()

    except requests.exceptions.RequestException as e:
        print(f"Error connecting to Ollama for evaluation: {e}")
        return jsonify({'error': f'評価モデルへの接続エラー: {e}'}), 500
    except Exception as e:
        print(f"An unexpected error occurred before Ollama evaluation call: {e}")
        return jsonify({'error': f'評価リクエスト前に予期せぬエラーが発生しました: {e}'}), 500

    try:
        response_content = ollama_response.json()['message']['content']
        print(f"Ollama evaluation response raw: {response_content[:100]}...")
        
        # Attempt to parse the JSON directly from the content
        # The model should ideally return *only* the JSON string when format='json'
        evaluation_result = json.loads(response_content)
        
        # Validate required fields
        if not all(k in evaluation_result for k in ('score', 'review', 'feedback')):
             raise ValueError("Evaluation result missing required fields.")
        if not isinstance(evaluation_result.get('score'), int):
             raise ValueError("Score must be an integer.")

        evaluation_result['comment'] = 'お疲れ様でした！'
        print(f"Parsed evaluation: {evaluation_result}")
        return jsonify(evaluation_result)

    except json.JSONDecodeError as e:
        print(f"Error decoding JSON evaluation from Ollama: {e}\nRaw content: {response_content}")
        # Fallback: Try to return something generic if JSON parsing fails but text exists
        return jsonify({'score': 0, 'review': '評価取得エラー', 'feedback': f'モデル応答の解析に失敗しました: {response_content}', 'comment': 'お疲れ様でした！'})
    except (KeyError, ValueError, Exception) as e:
        print(f"Error processing Ollama evaluation response: {e}\nRaw content: {response_content}")
        return jsonify({'score': 0, 'review': '評価処理エラー', 'feedback': f'評価結果の処理中にエラーが発生しました: {e}', 'comment': 'お疲れ様でした！'})

@app.route('/save-ranking', methods=['POST'])
def save_ranking():
    data = request.get_json()
    name = data.get('name', '名無し')
    score = data.get('score', 0)
    timestamp = datetime.now().isoformat()
    entry = {'name': name, 'score': score, 'timestamp': timestamp}
    try:
        if os.path.exists(RANKING_FILE):
            with open(RANKING_FILE, 'r', encoding='utf-8') as f:
                ranking = json.load(f)
        else:
            ranking = []
        ranking.append(entry)
        ranking.sort(key=lambda x: x['score'], reverse=True)
        with open(RANKING_FILE, 'w', encoding='utf-8') as f:
            json.dump(ranking, f, ensure_ascii=False, indent=2)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get-ranking', methods=['GET'])
def get_ranking():
    try:
        if os.path.exists(RANKING_FILE):
            with open(RANKING_FILE, 'r', encoding='utf-8') as f:
                ranking = json.load(f)
        else:
            ranking = []
        return jsonify({'ranking': ranking})
    except Exception as e:
        return jsonify({'ranking': [], 'error': str(e)})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)