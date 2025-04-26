document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    // Precondition selection
    const allPreconditionButtons = document.querySelectorAll('.precondition-btn'); // Get all buttons by class
    const selectedPreconditionText = document.getElementById('selected-precondition-text');

    // Chat
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');
    const chatHistory = document.getElementById('chat-history');
    const imageDisplay = document.getElementById('image-display');
    const suggestionButtonsArea = document.getElementById('suggestion-buttons-area'); // Added

    // Game Info & Results
    const turnCounterDisplay = document.getElementById('turn-counter');
    const finalScoreArea = document.getElementById('final-score-area');
    const finalScoreDisplay = document.getElementById('score-display');
    const finalReviewDisplay = document.getElementById('review-display');
    const finalFeedbackDisplay = document.getElementById('feedback-display');

    // --- Constants & State Variables ---
    const ollamaModel = 'gemma3:27b';
    const maxTurns = 6;
    const soundApiBaseUrl = 'http://192.168.0.221:9000/api/beat/'; // Sound API URL
    let currentTurn = 0; // Start turn count at 0 internally
    let selectedPreconditionKey = null; // 'A', 'B', or 'C'
    let conversationHistory = []; // Stores { sender: 'user'/'bot', text: '...' }
    let previousImageDataB64 = null; // Stores the *previous* turn's image data
    let isGameOver = false;
    let isProfileLocked = false; // Added flag

    // Match the texts from Python (Changed to shorter versions for UI display)
    const PRECONDITION_TEXTS = {
        A: "設定 A: 末期がんの65歳男性（元エンジニア）", // Shortened for UI
        B: "設定 B: ALSレベル4の55歳女性（元高校教師）", // Shortened for UI
        C: "設定 C: 末期がんの68歳男性（気難しい性格）" // Shortened for UI
    };

    // --- Suggestion Data --- 
    const turnSuggestions = {
        1: { // 初対面
            positive: ["お会いでき嬉しいです", "こちらこそ光栄です", "安心してくださいね", "よろしくお願いします", "お話伺えて光栄です"],
            negative: ["まず測定します", "検査から始めます", "書類にご記入を", "機器準備します", "次の予定です"]
        },
        2: { // 体調確認
            positive: ["つらさ教えてください", "詳しく聞かせて", "どこが痛いですか？", "いつからですか？", "楽な時もありますか？"],
            negative: ["呼吸数を測ります", "深呼吸は控えて", "装置を装着します", "数値を記録します", "動かないでください"]
        },
        3: { // 感情ケア
            positive: ["お気持ち分かります", "いつでも聞きます", "一緒に考えましょう", "寂しくないですか？", "支えますよ"],
            negative: ["余命を説明します", "次は検査結果です", "治療方針を話します", "記録に移ります", "時間がありません"]
        },
        4: { // 思い出共有
            positive: ["思い出聞かせて", "何が好きでしたか？", "素敵なお話ですね", "もっと教えてください", "心が温まります"],
            negative: ["面会制限あります", "許可が必要です", "感染対策します", "他の方もいます", "規則に従います"]
        },
        5: { // 最期の願い
            positive: ["希望を叶えます", "今すぐ手配します", "何が必要ですか？", "諦めず挑戦しましょう", "全力で支えます"],
            negative: ["外出は難しいです", "写真で代替いかが？", "室内で我慢を", "制限があります", "ベッド上で対応"]
        },
        6: { // 別れの言葉
            positive: ["寄り添えて光栄です", "お話でき嬉しいです", "安らかにお過ごしを", "いつでも戻ります", "ありがとうございました"],
            negative: ["次のケアに移ります", "失礼します", "時間となりました", "記録を完了します", "終了します"]
        }
    };

    // --- Helper Functions ---

    function addMessage(sender, text) {
        // sender: 'user' or 'bot'
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        if (sender === 'user') {
            messageDiv.classList.add('user-message');
        } else if (sender === 'bot') {
            messageDiv.classList.add('bot-message');
        }
        const p = document.createElement('p');
        p.innerHTML = text.replace(/\n/g, '<br>');
        messageDiv.appendChild(p);
        console.log('[addMessage] Attempting to append', sender, messageDiv);
        chatHistory.appendChild(messageDiv);
        console.log('[addMessage] Appended', sender, messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        console.log('[addMessage] Scrolled chat history.');
        // ログ
        console.log('[addMessage]', sender, text);
    }

    function showImageLoading() {
        imageDisplay.innerHTML = '<div class="loading-spinner"></div><p>画像を生成中...</p>';
    }

    function showImageError(message) {
        imageDisplay.innerHTML = `<p style="color: red;">画像生成エラー: ${message}</p>`;
    }

    function addThinkingMessage() {
        const thinkingDiv = document.createElement('div');
        thinkingDiv.classList.add('message', 'bot-message', 'bot-thinking');
        thinkingDiv.id = 'thinking-message'; 
        const p = document.createElement('p');
        p.textContent = '患者さんが返答を考えています...';
        thinkingDiv.appendChild(p);
        chatHistory.appendChild(thinkingDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return thinkingDiv;
    }

    function removeThinkingMessage() {
        const thinkingDiv = document.getElementById('thinking-message');
        if (thinkingDiv) {
            thinkingDiv.remove();
        }
    }

    function disableInput(disablePreconditionButtons = false) {
        promptInput.disabled = true;
        sendButton.disabled = true;
        if (disablePreconditionButtons) {
            allPreconditionButtons.forEach(button => button.disabled = true);
        }
    }

    function enableInput() {
        // Only enable if the game isn't over
        if (!isGameOver) {
            promptInput.disabled = false;
            sendButton.disabled = false;
            promptInput.focus();
            // Keep precondition buttons disabled after selection
        }
    }

    function updateTurnCounter() {
        // 表示は「現在ターン / 6」
        turnCounterDisplay.textContent = `${currentTurn} / 6`;
    }

    function selectPrecondition(key) {
        if (isProfileLocked) return; // Check if profile is locked

        if (isGameOver) return;

        selectedPreconditionKey = key;
        selectedPreconditionText.textContent = `選択中: ${PRECONDITION_TEXTS[key]}`;
        selectedPreconditionText.style.display = 'block'; // Show the text

        // --- Insert image at the top of chat history ---
        const chatHistoryDiv = document.getElementById('chat-history');
        if (chatHistoryDiv) {
            // Remove existing patient image if present
            const existingImage = chatHistoryDiv.querySelector('.chat-patient-image');
            if (existingImage) {
                existingImage.remove();
            }

            // Create and insert the new image
            const imgElement = document.createElement('img');
            imgElement.src = `/static/${key}.png`;
            imgElement.alt = `患者 ${key} の様子`;
            imgElement.classList.add('chat-patient-image'); // Add class for styling
            // Insert the image before the first message element
            chatHistoryDiv.insertBefore(imgElement, chatHistoryDiv.firstChild);
            console.log(`Inserted image /static/${key}.png into chat history.`);
        } else {
            console.error("Chat history element ('chat-history') not found.");
        }
        // --- End image insertion ---

        // Update button styles
        allPreconditionButtons.forEach(button => {
            const buttonKey = button.dataset.precondition;
            button.classList.toggle('selected', buttonKey === key);
            button.disabled = true; // Disable all after one is chosen
        });

        // Enable chat input now that a precondition is set
        enableInput();
        addMessage('system', `患者設定 ${key} を選択しました。対話を開始してください。`);
        displaySuggestions(1); // Show initial suggestions (remains turn 1)
    }

    async function getScoreAndReview() {
        console.log("Requesting score...");
        const finalScoreArea = document.getElementById('final-score-area');
        const finalScoreDisplay = document.getElementById('score-display');
        const finalReviewDisplay = document.getElementById('review-display');
        const finalFeedbackDisplay = document.getElementById('feedback-display');
        
        if (!finalScoreArea || !finalScoreDisplay || !finalReviewDisplay || !finalFeedbackDisplay) {
            console.error("One or more final score display elements not found.");
            return;
        }

        finalScoreArea.style.display = 'block';
        finalScoreDisplay.textContent = "計算中...";
        finalReviewDisplay.textContent = "";
        finalFeedbackDisplay.textContent = "";

        try {
            const response = await fetch('/calculate-score', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    conversationHistory: conversationHistory, // Send the recorded history
                    preconditionKey: selectedPreconditionKey
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `スコアリングサーバーエラー: ${response.status}`);
            }

            // Display results
            finalScoreDisplay.textContent = data.score !== undefined ? `${data.score} / 100` : "スコアなし";
            finalReviewDisplay.textContent = data.review || "レビューはありません。";
            finalFeedbackDisplay.textContent = data.feedback || "フィードバックはありません。";
            console.log("Score received:", data);

        } catch (error) {
            console.error('Scoring Error:', error);
            finalScoreDisplay.textContent = "評価エラー";
            finalReviewDisplay.textContent = `スコアの取得に失敗しました: ${error.message}`;
            finalFeedbackDisplay.textContent = "";
        }
    }

    async function endGameSequence() { // Make async again
        console.log("Ending game sequence...");
        isGameOver = true;
        disableInput(true); // Disable all inputs including precondition buttons

        // Add a message indicating the end
        addMessage('system', "<hr>患者さんは安らかに眠りにつきました。対話は終了です。あなたの関わりを評価します。<hr>");
        chatHistory.scrollTop = chatHistory.scrollHeight; // Scroll down

        // Re-enable score display area and call the scoring function
        const finalScoreArea = document.getElementById('final-score-area');
        if (finalScoreArea) {
             finalScoreArea.style.display = 'block'; // Ensure it's visible
             // Reset displays before getting score
             const scoreDisplay = document.getElementById('score-display');
             const reviewDisplay = document.getElementById('review-display');
             const feedbackDisplay = document.getElementById('feedback-display');
             if(scoreDisplay) scoreDisplay.textContent = '計算中...'; else console.error("Score display element missing");
             if(reviewDisplay) reviewDisplay.textContent = ''; else console.error("Review display element missing");
             if(feedbackDisplay) feedbackDisplay.textContent = ''; else console.error("Feedback display element missing");
        } else {
            console.error("Final score area element not found.");
        }
       
        // Call the scoring function again
        await getScoreAndReview(); 
        
        clearSuggestions(); // Clear any remaining suggestions
    }

    async function handleSendMessage() {
        if (isGameOver) return;
        const userMessage = promptInput.value.trim();
        if (!userMessage) return;
        addMessage('user', userMessage);
        conversationHistory.push({ role: 'user', content: userMessage });
        promptInput.value = '';
        disableInput();
        addThinkingMessage();
        try {
            const data = await chatWithOllama(userMessage);
            removeThinkingMessage();
            if (data && data.response) {
                addMessage('bot', data.response);
                conversationHistory.push({ role: 'bot', content: data.response });
            } else {
                addMessage('system', 'エラー：AIからの有効な応答がありませんでした。');
            }
            currentTurn++;
            updateTurnCounter();
            playAudioForTurn(currentTurn); // Play audio for the current turn
            if (currentTurn < 6) {
                enableInput();
                displaySuggestions(currentTurn);
            } else if (currentTurn === 6) {
                // 6/6のAI応答が表示された直後に評価と終了処理
                getScoreAndReview();
                addMessage('system', 'これで診療は終了です。お疲れ様でした。');
                disableInput();
                disableAllSuggestions();
                isGameOver = true;
            }
        } catch (error) {
            removeThinkingMessage();
            addMessage('system', error.message || 'エラーが発生しました。');
            enableInput();
        }
    }

    async function chatWithOllama(message) {
        // Send the current message AND the conversation history to the backend
        console.log("Sending to backend:", { message: message, history: conversationHistory }); 
        try {
            const response = await fetch('/chat-with-ollama', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message, 
                    conversationHistory: conversationHistory, // Include conversation history
                    model: ollamaModel, 
                    preconditionKey: selectedPreconditionKey
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: '不明なサーバーエラー' }));
                throw new Error(errorData.error || `サーバーエラー: ${response.status}`);
            }

            const data = await response.json();
            console.log("Received from backend:", data);

            // Do NOT addMessage('bot', ...) or push to conversationHistory here
            // Only handleSendMessage should do that

            return data; // Return the full data object (contains response and potentially suggestions)

        } catch (error) {
            console.error('Chat API Error:', error);
            // Rethrow the error so handleSendMessage can catch it and display to user
            throw new Error(`チャットAPIとの通信に失敗しました: ${error.message}`); 
        }
    }

    // --- Suggestion Button Functions --- 
    function displaySuggestions(turn, suggestions = []) {
        clearSuggestions(); // Clear previous buttons
        
        // Use the provided suggestions array if it's not empty, otherwise use default turn suggestions
        let suggestionsToShow = suggestions.length > 0 ? suggestions : turnSuggestions[turn];

        if (!suggestionsToShow || isGameOver) {
            console.log(`No suggestions for turn ${turn} or game over.`);
            return; // No suggestions for this turn or game is over
        }

        console.log(`Displaying suggestions for turn ${turn}:`, suggestionsToShow);

        // Check if suggestionsToShow is an array or object
        if (Array.isArray(suggestionsToShow)) {
            // It's an array (likely from backend), iterate directly
            suggestionsToShow.forEach(suggestionText => {
                createSuggestionButton(suggestionText);
            });
        } else if (typeof suggestionsToShow === 'object' && suggestionsToShow !== null) {
            // It's likely the object { positive: [...], negative: [...] }
            // Combine positive and negative suggestions
            const allSuggestions = [
                ...(suggestionsToShow.positive || []), 
                ...(suggestionsToShow.negative || [])
            ];
            allSuggestions.forEach(suggestionText => {
                createSuggestionButton(suggestionText);
            });
        } else {
            console.error("Unexpected format for suggestions:", suggestionsToShow);
        }
    }

    // Helper function to create a suggestion button
    function createSuggestionButton(text) {
        const button = document.createElement('button');
        button.textContent = text;
        button.classList.add('suggestion-btn'); // Use consistent class
        button.addEventListener('click', () => {
            promptInput.value = text; 
            handleSendMessage(); // Send immediately after clicking suggestion
        });
        suggestionButtonsArea.appendChild(button);
    }

    function clearSuggestions() {
        suggestionButtonsArea.innerHTML = ''; // Clear existing buttons
    }

    function disableAllSuggestions() {
        const suggestionButtons = document.querySelectorAll('.suggestion-btn');
        suggestionButtons.forEach(btn => btn.disabled = true);
    }

    function clearChatDisplay() {
        const chatHistoryDiv = document.getElementById('chat-history');
        if (chatHistoryDiv) {
             // Remove existing patient image first
            const existingImage = chatHistoryDiv.querySelector('.chat-patient-image');
            if (existingImage) {
                existingImage.remove();
            }
            // Remove all message elements
            chatHistoryDiv.innerHTML = ''; 
        }
    }
    // --- End Suggestion Button Functions ---

    // --- Audio Functions ---
    function playAudioForTurn(turn) {
        let audioFile = '';
        if (turn < 6) {
            audioFile = '/audio/beat_slow.mp3'; // Play slow heartbeat sound for every turn except the last
        } else if (turn === 6) {
            audioFile = '/audio/beat_stop.mp3'; // Play stop heartbeat sound at the end
        }

        if (audioFile) {
            const audio = new Audio(audioFile);
            audio.play();
        }
    }
    // --- End Audio Functions ---

    // --- Event Listeners ---
    sendButton.addEventListener('click', handleSendMessage);
    promptInput.addEventListener('keypress', (event) => {
        // Allow Shift+Enter for newlines, only send on Enter alone
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent default newline insertion
            handleSendMessage();
        }
    });

    // Add listeners for precondition buttons
    allPreconditionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const key = button.dataset.precondition; // Get the key from data-attribute
            selectPrecondition(key);
        });
    });

    // --- Initial Setup ---
    function initializeApp() {
        promptInput.focus();
        addMessage('system', '開始するには、まず患者の設定（A, B, C）を選択してください。');
        updateTurnCounter();
        disableInput(); // Keep input disabled until precondition is selected
        finalScoreArea.style.display = 'none'; // Hide score area initially
        selectedPreconditionText.style.display = 'none'; // Hide selected text initially
        clearSuggestions(); // Hide suggestions initially
        clearChatDisplay(); // Clear chat display initially

         // Clear any previous state if the page is reloaded (simple example)
        // In a real app, might need more robust state management
        conversationHistory = [];
        previousImageDataB64 = null;
        currentTurn = 0;
        isGameOver = false;
        selectedPreconditionKey = null;
        allPreconditionButtons.forEach(button => {
             button.classList.remove('selected');
             button.disabled = false;
        });
        chatHistory.innerHTML = ''; // Clear chat history visual
        imageDisplay.innerHTML = ''; // Clear image display
    }

    initializeApp(); // Run initialization

});
