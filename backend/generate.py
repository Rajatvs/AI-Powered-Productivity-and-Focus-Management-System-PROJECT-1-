

import time

from functools import lru_cache

from get_ai import get_ai




def generate(prompt, max_new_tokens=160):
    
    import torch


#1   USE THE MODEL TO GENERATE ANS
    tokenizer, model = get_ai() 



    messages = [

        {

            "role": "system",

            "content": (

                "You are FocusAI, a helpful study assistant. "

                "Give clear, accurate and easy-to-understand "

                "answers. Use only information supported by "

                "the provided notes. Do not invent facts."

            ),

        },

        {

            "role": "user",

            "content": prompt,

        },

    ]



    text = tokenizer.apply_chat_template(

        messages,

        tokenize=False,

        add_generation_prompt=True,

    )



    inputs = tokenizer(

        text,

        return_tensors="pt",

        truncation=True,

        max_length=4096,

    )



    device = next(model.parameters()).device



    inputs = {

        key: value.to(device)

        for key, value in inputs.items()

    }



    print("Generating AI response...")

    start_time = time.time()



    with torch.inference_mode():

        outputs = model.generate(

            **inputs,

            max_new_tokens=max_new_tokens,

            do_sample=False,

            repetition_penalty=1.08,

            pad_token_id=(

                tokenizer.pad_token_id

                if tokenizer.pad_token_id is not None

                else tokenizer.eos_token_id

            ),

            eos_token_id=tokenizer.eos_token_id,

        )



    elapsed = time.time() - start_time



    print(

        f"Generation completed in {elapsed:.1f} seconds"

    )



    prompt_length = inputs["input_ids"].shape[1]

    generated_ids = outputs[0][prompt_length:]



    response = tokenizer.decode(

        generated_ids,

        skip_special_tokens=True,

    ).strip()



    if not response:

        raise RuntimeError(

            "The AI model returned an empty response."

        )



    return response


